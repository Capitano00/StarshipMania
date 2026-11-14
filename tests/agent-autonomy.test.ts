import {describe, expect, it} from 'vitest';
import {Simulation} from '../src/simulation';
import {neutralFrame, type CommandEnvelope, type CommandGroup, type Order, type SquadOrder, type PilotControlFrame} from '../src/contracts';

let id = 0;
type Provenance = CommandEnvelope['provenance'];
const env = (s: Simulation, payload: Order | SquadOrder, group: CommandGroup, provenance: Provenance): CommandEnvelope =>
  ({...s.envelope({type: 'RECALL'}, provenance, `cmd-${++id}`, group), payload});
const squad = (s: Simulation, assignments: SquadOrder['assignments'], provenance: Provenance = 'local-approved-proposal') =>
  env(s, {type: 'SQUAD', assignments}, 'funnels', provenance);
const autonomy = (s: Simulation, enabled: boolean, fire = true) => s.step(neutralFrame(), [], false, [s.intent({type: 'AUTONOMY', enabled, fire}, 'local-button')]);
const orders = (s: Simulation) => s.funnels.map(f => f.order.type === 'INTERCEPT' ? f.order.targetId : 'RECALL');
const frame = (padisarahFire = false): PilotControlFrame => ({...neutralFrame(), padisarahFire});

describe('atomic squad assignments', () => {
  it('assigns U1 and U2 different targets in one validated operation', () => {
    const s = new Simulation();
    s.step(neutralFrame(), [squad(s, [{unit: 'U1', targetId: 'T1'}, {unit: 'U2', targetId: 'T3'}])]);
    expect(orders(s)).toEqual(['T1', 'T3']);
    expect(s.funnels[0].assignment).toBe(s.funnels[1].assignment);
    expect(s.events.entries[0]).toMatchObject({action: 'Squad deploy', outcome: 'Accepted'});
    expect(s.message).toBe('Squad assignment accepted: U1→T1, U2→T3');
    expect(s.commandLog[0]).toMatchObject({outcome: 'accepted', units: ['U1', 'U2'], squad: [{unit: 'U1', targetId: 'T1'}, {unit: 'U2', targetId: 'T3'}]});
  });

  it('is all-or-nothing: one bad entry rejects the whole plan', () => {
    const s = new Simulation();
    s.turrets.find(t => t.id === 'T3')!.health = 0;
    const cases: [SquadOrder['assignments'], string][] = [
      [[{unit: 'U1', targetId: 'T1'}, {unit: 'U2', targetId: 'T3'}], 'Target no longer available'],
      [[{unit: 'U1', targetId: 'T1'}, {unit: 'U1', targetId: 'T2'}], 'Invalid squad plan'],
      [[{unit: 'U1', targetId: 'T1'}, {unit: 'U9' as 'U1', targetId: 'T2'}], 'Invalid squad plan'],
      [[], 'Invalid squad plan'],
    ];
    for (const [assignments, reason] of cases) {
      expect(s.accept(squad(s, assignments))).toBe(false);
      expect(s.commandLog[0].reason).toBe(reason);
      expect(orders(s)).toEqual(['RECALL', 'RECALL']);
    }
    expect(s.accept({...squad(s, [{unit: 'U1', targetId: 'T1'}]), group: 'U1'})).toBe(false);
    expect(s.accept(squad(s, [{unit: 'U1', targetId: 'T1'}], 'local-hand-commit'))).toBe(false);
  });

  it('a same-tick Recall (group, or for any unit in the plan) rejects the whole squad plan', () => {
    const s = new Simulation();
    s.step(neutralFrame(), [squad(s, [{unit: 'U1', targetId: 'T1'}, {unit: 'U2', targetId: 'T3'}]), env(s, {type: 'RECALL'}, 'U2', 'local-keyboard-recall')]);
    expect(orders(s)).toEqual(['RECALL', 'RECALL']);
    expect(s.commandLog.find(r => r.squad)?.reason).toBe('Recall takes precedence');
    s.step(neutralFrame(), [env(s, {type: 'RECALL'}, 'funnels', 'local-keyboard-recall'), squad(s, [{unit: 'U1', targetId: 'T1'}])]);
    expect(orders(s)).toEqual(['RECALL', 'RECALL']);
  });

  it('is unavailable in guided practice', () => {
    const t = new Simulation('p', 'training');
    expect(t.accept(squad(t, [{unit: 'U1', targetId: 'T1'}]))).toBe(false);
  });
});

describe('pilot-controlled autonomy', () => {
  it('is OFF by default and autonomous orders are rejected while OFF', () => {
    const s = new Simulation();
    expect(s.autonomy).toEqual({enabled: false, fire: false});
    expect(s.accept(env(s, {type: 'INTERCEPT', targetId: 'T1'}, 'U1', 'local-autonomous'))).toBe(false);
    expect(s.commandLog[0].reason).toBe('Autonomy disabled');
  });

  it('is a pilot intent: rejected in practice and in the same tick as a manual order', () => {
    const t = new Simulation('p', 'training');
    autonomy(t, true);
    expect(t.autonomy.enabled).toBe(false);
    const s = new Simulation();
    s.step(neutralFrame(), [s.envelope({type: 'INTERCEPT', targetId: 'T1'}, 'local-hand-commit', `cmd-${++id}`)], false, [s.intent({type: 'AUTONOMY', enabled: true, fire: true})]);
    expect(s.autonomy.enabled).toBe(false);
    expect(s.events.entries.some(e => e.action === 'Autonomy' && e.outcome === 'Rejected')).toBe(true);
  });

  it('autonomous unit and squad orders execute only while ON, never as a group intercept or group Recall', () => {
    const s = new Simulation();
    autonomy(s, true);
    expect(s.autonomy).toEqual({enabled: true, fire: true});
    expect(s.accept(env(s, {type: 'INTERCEPT', targetId: 'T1'}, 'U1', 'local-autonomous'))).toBe(true);
    expect(s.funnels[0].autonomous).toBe(true);
    expect(s.accept(squad(s, [{unit: 'U1', targetId: 'T2'}, {unit: 'U2', targetId: 'T3'}], 'local-autonomous'))).toBe(true);
    expect(s.funnels.every(f => f.autonomous)).toBe(true);
    expect(s.accept(env(s, {type: 'INTERCEPT', targetId: 'T1'}, 'funnels', 'local-autonomous'))).toBe(false);
    expect(s.accept(env(s, {type: 'RECALL'}, 'funnels', 'local-autonomous'))).toBe(false);
    expect(s.accept(env(s, {type: 'RECALL'}, 'U2', 'local-autonomous'))).toBe(true);
    expect(s.funnels[1].order).toEqual({type: 'RECALL'});
    expect(s.recalls).toBe(0);
    // A pilot order clears the agent marker on every unit it reassigns.
    s.step(neutralFrame(), [s.envelope({type: 'INTERCEPT', targetId: 'T2'}, 'local-hand-commit', `cmd-${++id}`)]);
    expect(s.funnels.some(f => f.autonomous)).toBe(false);
  });

  it('autonomous assignments fire without pilot fire input when the grant includes fire', () => {
    const s = new Simulation();
    s.turrets.forEach(t => t.armed = false);
    autonomy(s, true, true);
    s.step(neutralFrame(), [env(s, {type: 'INTERCEPT', targetId: 'T4'}, 'U1', 'local-autonomous')]);
    for (let i = 0; i < 3000 && s.turrets.find(t => t.id === 'T4')!.health > 0; i++) s.step(neutralFrame());
    expect(s.turrets.find(t => t.id === 'T4')!.health).toBe(0);
    expect(s.lastHit).toMatchObject({team: 'funnel', shooter: 'U1', target: 'T4'});
    expect(s.padisarahFire).toBe(false);
  });

  it('holds fire for approved (non-autonomous) orders, for move-only grants, and after autonomy is switched off', () => {
    for (const setup of ['approved', 'move-only', 'switched-off'] as const) {
      const s = new Simulation();
      s.turrets.forEach(t => t.armed = false);
      if (setup === 'approved') s.step(neutralFrame(), [env(s, {type: 'INTERCEPT', targetId: 'T4'}, 'U1', 'local-approved-proposal')]);
      else {
        autonomy(s, true, setup !== 'move-only');
        s.step(neutralFrame(), [env(s, {type: 'INTERCEPT', targetId: 'T4'}, 'U1', 'local-autonomous')]);
        if (setup === 'switched-off') autonomy(s, false);
      }
      for (let i = 0; i < 1500; i++) s.step(neutralFrame());
      expect(s.funnels[0].order).toEqual({type: 'INTERCEPT', targetId: 'T4'});
      expect(s.turrets.find(t => t.id === 'T4')!.health).toBe(100);
      // Pilot fire permission still works as before.
      for (let i = 0; i < 400; i++) s.step(frame(true));
      expect(s.turrets.find(t => t.id === 'T4')!.health).toBeLessThan(100);
    }
  });

  it('pilot commands take control back: manual deploy or emergency Recall switch autonomy off and bump the control epoch', () => {
    for (const pilot of ['deploy', 'recall'] as const) {
      const s = new Simulation();
      autonomy(s, true);
      const epoch = s.controlEpoch;
      s.step(neutralFrame(), [pilot === 'deploy' ? s.envelope({type: 'INTERCEPT', targetId: 'T2'}, 'local-hand-commit', `cmd-${++id}`) : s.envelope({type: 'RECALL'}, 'local-keyboard-recall', `cmd-${++id}`)]);
      expect(s.autonomy).toEqual({enabled: false, fire: false});
      expect(s.controlEpoch).toBeGreaterThan(epoch);
      expect(s.events.entries.find(e => e.action === 'Autonomy')?.detail).toBe(pilot === 'deploy' ? 'Pilot took manual control' : 'Emergency Recall');
    }
  });

  it('in one tick, the pilot order wins over an autonomous order regardless of queue order', () => {
    for (const reverse of [false, true]) {
      const s = new Simulation();
      autonomy(s, true);
      const batch = [env(s, {type: 'INTERCEPT', targetId: 'T3'}, 'U1', 'local-autonomous'), s.envelope({type: 'INTERCEPT', targetId: 'T2'}, 'local-hand-commit', `cmd-${++id}`)];
      s.step(neutralFrame(), reverse ? batch.reverse() : batch);
      expect(orders(s)).toEqual(['T2', 'T2']);
      expect(s.commandLog.find(r => r.provenance === 'local-autonomous')?.reason).toBe('Autonomy disabled');
    }
  });

  it('an agent unit Recall never blocks a same-tick pilot order; a pilot unit Recall still does', () => {
    const s = new Simulation();
    s.step(neutralFrame(), [env(s, {type: 'RECALL'}, 'U1', 'local-approved-proposal'), s.envelope({type: 'INTERCEPT', targetId: 'T2'}, 'local-hand-commit', `cmd-${++id}`)]);
    expect(orders(s)).toEqual(['T2', 'T2']);
    s.step(neutralFrame(), [env(s, {type: 'RECALL'}, 'U1', 'local-keyboard-recall'), s.envelope({type: 'INTERCEPT', targetId: 'T3'}, 'local-hand-commit', `cmd-${++id}`)]);
    expect(orders(s)).toEqual(['RECALL', 'T2']);
  });

  it('Fire at Will and autonomy are mutually exclusive', () => {
    const s = new Simulation();
    autonomy(s, true);
    s.step(neutralFrame(), [], false, [s.intent({type: 'DRONE_POLICY', enabled: true, mode: 'A'})]);
    expect([s.fireAtWill, s.autonomy.enabled]).toEqual([true, false]);
    autonomy(s, true);
    expect([s.fireAtWill, s.autonomy.enabled]).toEqual([false, true]);
  });

  it('a new round (Retry) always starts with autonomy OFF', () => {
    const s = new Simulation('run-1');
    autonomy(s, true);
    expect(new Simulation('run-2').autonomy.enabled).toBe(false);
  });
});

describe('pilot fire readout', () => {
  it('reports autonomous fire instead of "Holding fire" only when the autonomy grant applies', () => {
    const s = new Simulation();
    expect(s.fireState).toBe('Holding fire');
    autonomy(s, true, true);
    s.step(neutralFrame(), [env(s, {type: 'INTERCEPT', targetId: 'T4'}, 'U1', 'local-autonomous')]);
    expect(s.fireState).toBe('Autonomous fire: U1');
    autonomy(s, false);
    expect(s.fireState).toBe('Holding fire');
  });
});
