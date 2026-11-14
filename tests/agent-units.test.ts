import {describe, expect, it} from 'vitest';
import {Simulation} from '../src/simulation';
import {neutralFrame, type CommandGroup, type Order} from '../src/contracts';

let id = 0;
const cmd = (s: Simulation, order: Order, group: CommandGroup = 'funnels', provenance?: Parameters<Simulation['envelope']>[1]) =>
  s.envelope(order, provenance ?? (order.type === 'RECALL' ? 'local-keyboard-recall' : 'local-hand-commit'), `cmd-${++id}`, group);
const step = (s: Simulation, commands: unknown[] = [], n = 1) => { s.step(neutralFrame(), commands); for (let i = 1; i < n; i++) s.step(neutralFrame()); };
const orders = (s: Simulation) => s.funnels.map(f => f.order.type === 'INTERCEPT' ? f.order.targetId : 'RECALL');

describe('independent U1/U2 intercepts', () => {
  it('a unit-addressed intercept assigns only that unit', () => {
    const s = new Simulation();
    step(s, [cmd(s, {type: 'INTERCEPT', targetId: 'T1'}, 'U1')]);
    expect(orders(s)).toEqual(['T1', 'RECALL']);
    expect(s.events.entries[0]).toMatchObject({action: 'Unit deploy', outcome: 'Accepted', target: 'T1'});
    expect(s.deployments).toBe(1);
  });

  it('U1 and U2 hold different targets and both plan routes to them', () => {
    const s = new Simulation();
    step(s, [cmd(s, {type: 'INTERCEPT', targetId: 'T1'}, 'U1'), cmd(s, {type: 'INTERCEPT', targetId: 'T3'}, 'U2')], 30);
    expect(orders(s)).toEqual(['T1', 'T3']);
    expect(s.groupState).toBe('U1: T1 / U2: T3');
    const [u1, u2] = s.funnels;
    expect(u1.destination).not.toEqual(u2.destination);
    expect(u1.destination.x).toBeLessThan(0);
    expect(u2.destination.x).toBeGreaterThan(0);
  });

  it('the original group intercept still assigns every unit', () => {
    const s = new Simulation();
    step(s, [cmd(s, {type: 'INTERCEPT', targetId: 'T2'})]);
    expect(orders(s)).toEqual(['T2', 'T2']);
    expect(s.events.entries[0].action).toBe('Deploy / redirect');
  });

  it('rejects unknown units, foreign groups and per-unit orders in guided practice', () => {
    const s = new Simulation();
    expect(s.accept(cmd(s, {type: 'INTERCEPT', targetId: 'T1'}, 'U9'))).toBe(false);
    expect(s.accept({...cmd(s, {type: 'INTERCEPT', targetId: 'T1'}), group: 'everything'})).toBe(false);
    const t = new Simulation('run-1', 'training');
    expect(t.accept(cmd(t, {type: 'INTERCEPT', targetId: 'T1'}, 'U1'))).toBe(false);
    expect(t.commandLog[0].reason).toBe('Per-unit orders unavailable in guided practice');
    expect(t.accept(cmd(t, {type: 'INTERCEPT', targetId: 'T1'}))).toBe(true);
  });

  it('an approved proposal may deploy or recall a unit, but never issue the group emergency Recall', () => {
    const s = new Simulation();
    expect(s.accept(cmd(s, {type: 'INTERCEPT', targetId: 'T1'}, 'U2', 'local-approved-proposal'))).toBe(true);
    expect(s.accept(cmd(s, {type: 'RECALL'}, 'U2', 'local-approved-proposal'))).toBe(true);
    expect(s.accept(cmd(s, {type: 'RECALL'}, 'funnels', 'local-approved-proposal'))).toBe(false);
    expect(s.commandLog[0].reason).toBe('Invalid recall authority');
    expect(s.recalls).toBe(0);
  });

  it('a per-unit order exits Fire at Will like any accepted manual order', () => {
    const s = new Simulation();
    s.step(neutralFrame(), [], false, [s.intent({type: 'DRONE_POLICY', enabled: true, mode: 'A'})]);
    expect(s.fireAtWill).toBe(true);
    step(s, [cmd(s, {type: 'INTERCEPT', targetId: 'T2'}, 'U1')]);
    expect(s.fireAtWill).toBe(false);
    expect(s.events.entries.some(e => e.action === 'Fire at will' && e.detail === 'Accepted manual unit order')).toBe(true);
    expect(s.funnels[0].order).toEqual({type: 'INTERCEPT', targetId: 'T2'});
  });
});

describe('individual Recall with the group Recall kept absolute', () => {
  it('recalls one unit and leaves the other on task', () => {
    const s = new Simulation();
    step(s, [cmd(s, {type: 'INTERCEPT', targetId: 'T1'})]);
    step(s, [cmd(s, {type: 'RECALL'}, 'U1')]);
    expect(orders(s)).toEqual(['RECALL', 'T1']);
    expect(s.unitRecalls).toBe(1);
    expect(s.recalls).toBe(0);
    expect(s.events.entries[0]).toMatchObject({action: 'Unit recall', outcome: 'Accepted'});
  });

  it('a unit Recall beats a same-tick order for that unit only, in either queue order', () => {
    for (const reverse of [false, true]) {
      const s = new Simulation();
      const batch = [cmd(s, {type: 'INTERCEPT', targetId: 'T2'}, 'U1'), cmd(s, {type: 'INTERCEPT', targetId: 'T3'}, 'U2'), cmd(s, {type: 'RECALL'}, 'U1')];
      step(s, reverse ? batch.reverse() : batch);
      expect(orders(s)).toEqual(['RECALL', 'T3']);
    }
  });

  it('a unit Recall also blocks a same-tick group intercept that would include that unit', () => {
    const s = new Simulation();
    step(s, [cmd(s, {type: 'RECALL'}, 'U2'), cmd(s, {type: 'INTERCEPT', targetId: 'T2'})]);
    expect(orders(s)).toEqual(['RECALL', 'RECALL']);
    expect(s.commandLog.find(r => r.order?.type === 'INTERCEPT')?.reason).toBe('Recall takes precedence');
  });

  it('the group Recall still wins the whole batch over unit orders, regardless of order', () => {
    for (const reverse of [false, true]) {
      const s = new Simulation();
      step(s, [cmd(s, {type: 'INTERCEPT', targetId: 'T1'})]);
      const batch = [cmd(s, {type: 'INTERCEPT', targetId: 'T2'}, 'U1'), cmd(s, {type: 'RECALL'}, 'U2'), cmd(s, {type: 'RECALL'})];
      step(s, reverse ? batch.reverse() : batch);
      expect(orders(s)).toEqual(['RECALL', 'RECALL']);
      expect(s.recalls).toBe(1);
      expect(s.unitRecalls).toBe(0);
      expect(s.commandLog.filter(r => r.reason === 'Recall takes precedence')).toHaveLength(2);
    }
  });

  it('after a group Recall, unit intercepts in a later batch of the same tick are rejected; next tick they work', () => {
    const s = new Simulation();
    s.commands([cmd(s, {type: 'RECALL'})]);
    expect(s.accept(cmd(s, {type: 'INTERCEPT', targetId: 'T1'}, 'U1'))).toBe(false);
    step(s);
    expect(s.accept(cmd(s, {type: 'INTERCEPT', targetId: 'T1'}, 'U1'))).toBe(true);
  });
});

describe('command log', () => {
  it('records accepted units with their assignment and rejected reasons, newest first and bounded', () => {
    const s = new Simulation();
    s.accept(cmd(s, {type: 'INTERCEPT', targetId: 'T1'}, 'U2'));
    expect(s.commandLog[0]).toMatchObject({outcome: 'accepted', group: 'U2', units: ['U2'], assignment: s.accepted, order: {type: 'INTERCEPT', targetId: 'T1'}});
    expect(s.funnels[1].assignment).toBe(s.commandLog[0].assignment);
    s.accept({junk: true});
    expect(s.commandLog[0]).toMatchObject({outcome: 'rejected', reason: 'Invalid envelope fields', commandId: null, order: null});
    for (let i = 0; i < 80; i++) s.accept(null);
    expect(s.commandLog).toHaveLength(64);
  });
});
