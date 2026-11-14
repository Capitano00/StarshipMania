import {describe, expect, it} from 'vitest';
import {Simulation} from '../src/simulation';
import {neutralFrame, type ActionIntent, type CommandEnvelope} from '../src/contracts';
import {AgentController, nearestArmedTurret} from '../src/agent/controller';
import {snapshot} from '../src/agent/snapshot';

/** The intended main.ts wiring: drain → step → observe, once per fixed tick. */
let pilotId = 0;
const tick = (sim: Simulation, ctrl: AgentController, opts: {pilot?: CommandEnvelope[]; intents?: ActionIntent[]; padisarahFire?: boolean} = {}) => {
  const agent = ctrl.drain(sim);
  sim.step({...neutralFrame(), padisarahFire: opts.padisarahFire}, [...(opts.pilot ?? []), ...agent], false, opts.intents ?? []);
  return {sent: agent, events: ctrl.observe(sim)};
};
const run = (sim: Simulation, ctrl: AgentController, n: number) => { for (let i = 0; i < n && sim.outcome === 'playing'; i++) tick(sim, ctrl); };
const pilotRecall = (sim: Simulation) => sim.envelope({type: 'RECALL'}, 'local-keyboard-recall', `cmd-${++pilotId}`);
const pilotDeploy = (sim: Simulation, targetId: 'T1' | 'T2') => sim.envelope({type: 'INTERCEPT', targetId}, 'local-hand-commit', `cmd-${++pilotId}`);
const setAutonomy = (sim: Simulation, ctrl: AgentController, enabled: boolean, fire = true) => tick(sim, ctrl, {intents: [sim.intent({type: 'AUTONOMY', enabled, fire}, 'local-button')]});
const basis = (sim: Simulation) => AgentController.basis(sim);

describe('autonomy OFF (default): actions are proposals needing pilot approval', () => {
  it('nothing reaches the simulation until the pilot approves', () => {
    const sim = new Simulation('a'), ctrl = new AgentController();
    tick(sim, ctrl);
    const r = ctrl.submit(sim, {kind: 'intercept', unit: 'U1', target: 'T1', reason: 'Nearest armed turret'}, basis(sim));
    expect(r).toMatchObject({ok: true, mode: 'awaiting_approval'});
    if (!r.ok) return;
    run(sim, ctrl, 30);
    expect(sim.funnels[0].order.type).toBe('RECALL');
    expect(ctrl.pending().map(p => p.id)).toEqual([r.proposalId]);
    expect(ctrl.approve(r.proposalId, sim)).toEqual({ok: true});
    const {sent} = tick(sim, ctrl);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({provenance: 'local-approved-proposal', group: 'U1', runId: 'a', issuedAtTick: sim.tick - 1, payload: {type: 'INTERCEPT', targetId: 'T1'}});
    expect(sent[0].commandId).toBe('cmd-900000001');
    run(sim, ctrl, 5);
    expect(sim.funnels[0].order).toEqual({type: 'INTERCEPT', targetId: 'T1'});
    expect(ctrl.task(r.taskIds[0])).toMatchObject({status: 'executing', reason: 'Nearest armed turret'});
  });

  it('dismissed proposals never execute', () => {
    const sim = new Simulation('b'), ctrl = new AgentController();
    const r = ctrl.submit(sim, {kind: 'recall', unit: 'U2'}, basis(sim));
    if (!r.ok) throw new Error(r.error);
    expect(ctrl.dismiss(r.proposalId, sim.tick)).toBe(true);
    expect(ctrl.approve(r.proposalId, sim).ok).toBe(false);
    expect(tick(sim, ctrl).sent).toEqual([]);
    expect(ctrl.task(r.taskIds[0])?.status).toBe('dismissed');
  });

  it('a newer decision replaces an older unapproved proposal for the same unit', () => {
    const sim = new Simulation('c'), ctrl = new AgentController();
    const a = ctrl.submit(sim, {kind: 'intercept', unit: 'U1', target: 'T1'}, basis(sim));
    const b = ctrl.submit(sim, {kind: 'intercept', unit: 'U1', target: 'T2'}, basis(sim));
    if (!a.ok || !b.ok) throw new Error('submit failed');
    expect(ctrl.proposal(a.proposalId)).toMatchObject({status: 'dismissed', detail: 'Superseded by a newer proposal'});
    expect(ctrl.pending().map(p => p.id)).toEqual([b.proposalId]);
  });
});

describe('autonomy ON: validated agent orders execute and fire within the grant', () => {
  it('an autonomous intercept executes without approval, fires, and completes', () => {
    const sim = new Simulation('d'), ctrl = new AgentController();
    sim.turrets.forEach(t => t.armed = false);
    setAutonomy(sim, ctrl, true);
    const r = ctrl.submit(sim, {kind: 'intercept', unit: 'U1', target: 'T4', reason: 'Clear the flank'}, basis(sim));
    expect(r).toMatchObject({ok: true, mode: 'queued_autonomous'});
    if (!r.ok) return;
    const {sent} = tick(sim, ctrl);
    expect(sent[0]).toMatchObject({provenance: 'local-autonomous', group: 'U1'});
    const events = [];
    for (let i = 0; i < 3000 && ctrl.task(r.taskIds[0])?.status !== 'completed'; i++) events.push(...tick(sim, ctrl).events);
    expect(ctrl.task(r.taskIds[0])).toMatchObject({status: 'completed', detail: 'T4 destroyed by U1'});
    expect(events.some(e => e.kind === 'turret_destroyed' && e.target === 'T4' && e.data.by === 'U1')).toBe(true);
    expect(sim.padisarahFire).toBe(false);
  });

  it('an autonomous squad plan assigns both units atomically', () => {
    const sim = new Simulation('e'), ctrl = new AgentController();
    setAutonomy(sim, ctrl, true);
    const r = ctrl.submit(sim, {kind: 'squad', assignments: [{unit: 'U1', target: 'T1'}, {unit: 'U2', target: 'T3'}]}, basis(sim));
    if (!r.ok) throw new Error(r.error);
    run(sim, ctrl, 3);
    expect(sim.funnels.map(f => f.order)).toEqual([{type: 'INTERCEPT', targetId: 'T1'}, {type: 'INTERCEPT', targetId: 'T3'}]);
    expect(r.taskIds.map(id => ctrl.task(id)?.status)).toEqual(['executing', 'executing']);
    sim.turrets.find(t => t.id === 'T3')!.health = 0;
    expect(ctrl.submit(sim, {kind: 'squad', assignments: [{unit: 'U1', target: 'T2'}, {unit: 'U2', target: 'T3'}]}, basis(sim))).toMatchObject({ok: false, code: 'invalid'});
    expect(sim.funnels[0].order).toEqual({type: 'INTERCEPT', targetId: 'T1'});
  });

  it('the pilot taking manual control switches autonomy off and supersedes agent tasks', () => {
    const sim = new Simulation('f'), ctrl = new AgentController();
    setAutonomy(sim, ctrl, true);
    const r = ctrl.submit(sim, {kind: 'intercept', unit: 'U1', target: 'T1'}, basis(sim));
    if (!r.ok) throw new Error(r.error);
    run(sim, ctrl, 3);
    tick(sim, ctrl, {pilot: [pilotDeploy(sim, 'T2')]});
    expect(sim.autonomy.enabled).toBe(false);
    expect(ctrl.task(r.taskIds[0])).toMatchObject({status: 'superseded', detail: 'Replaced by order: T2'});
  });
});

describe('stale and cancelled decisions cannot resurrect', () => {
  it('a decision based on a snapshot from before an emergency Recall is rejected', () => {
    const sim = new Simulation('g'), ctrl = new AgentController();
    setAutonomy(sim, ctrl, true);
    const snap = snapshot(sim); // what the model was looking at
    const decidedAt = {runId: snap.runId, epoch: snap.control.epoch};
    tick(sim, ctrl, {pilot: [pilotRecall(sim)]});
    expect(sim.autonomy.enabled).toBe(false);
    const late = ctrl.submit(sim, {kind: 'intercept', unit: 'U1', target: 'T1'}, decidedAt);
    expect(late).toMatchObject({ok: false, code: 'stale'});
  });

  it('a decision from before autonomy was switched off and on again is still stale', () => {
    const sim = new Simulation('h'), ctrl = new AgentController();
    setAutonomy(sim, ctrl, true);
    const decidedAt = basis(sim);
    setAutonomy(sim, ctrl, false);
    setAutonomy(sim, ctrl, true);
    expect(ctrl.submit(sim, {kind: 'intercept', unit: 'U1', target: 'T1'}, decidedAt)).toMatchObject({ok: false, code: 'stale'});
    expect(ctrl.submit(sim, {kind: 'intercept', unit: 'U1', target: 'T1'}, basis(sim))).toMatchObject({ok: true});
  });

  it('an emergency Recall cancels pending proposals: tasks are recalled and approval is refused', () => {
    const sim = new Simulation('i'), ctrl = new AgentController();
    const r = ctrl.submit(sim, {kind: 'squad', assignments: [{unit: 'U1', target: 'T1'}, {unit: 'U2', target: 'T2'}]}, basis(sim));
    if (!r.ok) throw new Error(r.error);
    const {events} = tick(sim, ctrl, {pilot: [pilotRecall(sim)]});
    expect(r.taskIds.map(id => ctrl.task(id)?.status)).toEqual(['recalled', 'recalled']);
    expect(ctrl.proposal(r.proposalId)).toMatchObject({status: 'cancelled', detail: 'Emergency Recall'});
    expect(ctrl.approve(r.proposalId, sim).ok).toBe(false);
    run(sim, ctrl, 10);
    expect(sim.funnels.every(f => f.order.type === 'RECALL')).toBe(true);
    expect(events.some(e => e.kind === 'recall' && e.data.scope === 'all')).toBe(true);
  });

  it('a queued autonomous order is dropped if autonomy is switched off before it is sent', () => {
    const sim = new Simulation('j'), ctrl = new AgentController();
    setAutonomy(sim, ctrl, true);
    const r = ctrl.submit(sim, {kind: 'intercept', unit: 'U1', target: 'T1'}, basis(sim));
    if (!r.ok) throw new Error(r.error);
    sim.step(neutralFrame(), [], false, [sim.intent({type: 'AUTONOMY', enabled: false, fire: false}, 'local-button')]); // pilot acts before the next drain
    expect(ctrl.drain(sim)).toEqual([]);
    expect(ctrl.proposal(r.proposalId)).toMatchObject({status: 'cancelled', detail: 'Autonomy switched off before execution'});
  });

  it('Retry cancels pending work, fails open tasks and invalidates old decisions', () => {
    const first = new Simulation('run-1'), ctrl = new AgentController();
    tick(first, ctrl);
    const decidedAt = basis(first);
    const r = ctrl.submit(first, {kind: 'intercept', unit: 'U1', target: 'T1'}, decidedAt);
    if (!r.ok) throw new Error(r.error);
    expect(ctrl.approve(r.proposalId, first).ok).toBe(true); // approved but not yet sent
    const second = new Simulation('run-2');
    const {sent, events} = tick(second, ctrl);
    expect(sent).toEqual([]);
    expect(ctrl.proposal(r.proposalId)?.status).toBe('cancelled');
    expect(ctrl.task(r.taskIds[0])).toMatchObject({status: 'failed', detail: 'Round reset (Retry) before completion'});
    expect(events.some(e => e.kind === 'round_started')).toBe(true);
    expect(ctrl.submit(second, {kind: 'intercept', unit: 'U1', target: 'T1'}, decidedAt)).toMatchObject({ok: false, code: 'stale'});
    expect(second.funnels[0].order.type).toBe('RECALL');
  });

  it('agent command ids never collide with pilot command ids', () => {
    const sim = new Simulation('k'), ctrl = new AgentController();
    const r = ctrl.submit(sim, {kind: 'intercept', unit: 'U2', target: 'T3'}, basis(sim));
    if (!r.ok) throw new Error(r.error);
    tick(sim, ctrl, {pilot: [sim.envelope({type: 'INTERCEPT', targetId: 'T1'}, 'local-hand-commit', 'cmd-1')]});
    ctrl.approve(r.proposalId, sim);
    tick(sim, ctrl);
    tick(sim, ctrl, {pilot: [sim.envelope({type: 'INTERCEPT', targetId: 'T2'}, 'local-hand-commit', 'cmd-2')]});
    expect(sim.commandLog.filter(x => x.outcome === 'rejected')).toEqual([]);
    expect(sim.commandLog.map(x => x.commandId).reverse()).toEqual(['cmd-1', 'cmd-900000001', 'cmd-2']);
  });

  it('is refused in guided practice and after the round ends', () => {
    const t = new Simulation('p', 'training'), ctrl = new AgentController();
    expect(ctrl.submit(t, {kind: 'intercept', unit: 'U1', target: 'T1'}, basis(t))).toMatchObject({ok: false, code: 'unavailable'});
    const s = new Simulation('q'); s.outcome = 'won';
    expect(ctrl.submit(s, {kind: 'recall', unit: 'U1'}, basis(s))).toMatchObject({ok: false, code: 'unavailable'});
  });
});

describe('defend-pilot objective', () => {
  it('targets the nearest living, armed turret to the mech, from real state', () => {
    const sim = new Simulation('r'), ctrl = new AgentController();
    const snap = snapshot(sim);
    const expected = snap.turrets.filter(t => t.alive && t.armed).sort((a, b) => a.distanceToMech - b.distanceToMech)[0].id;
    expect(nearestArmedTurret(sim)).toBe(expected);
    const r = ctrl.submit(sim, {kind: 'defend', unit: 'U2', reason: 'Protect the pilot'}, basis(sim));
    expect(r).toMatchObject({ok: true, resolved: {kind: 'intercept', unit: 'U2', target: expected}});
    sim.turrets.find(t => t.id === expected)!.health = 0;
    expect(nearestArmedTurret(sim)).not.toBe(expected);
    sim.turrets.forEach(t => { if (t.armed) t.health = 0; });
    expect(ctrl.submit(sim, {kind: 'defend', unit: 'U1'}, basis(sim))).toMatchObject({ok: false, error: 'No armed turret is left to defend against.'});
  });
});

describe('recent event history', () => {
  it('is queryable by cursor, kind and unit, and bounded', () => {
    const sim = new Simulation('s'), ctrl = new AgentController({eventCapacity: 20});
    tick(sim, ctrl);
    const start = ctrl.log.cursor;
    setAutonomy(sim, ctrl, true);
    const r = ctrl.submit(sim, {kind: 'intercept', unit: 'U1', target: 'T1'}, basis(sim));
    if (!r.ok) throw new Error(r.error);
    run(sim, ctrl, 3);
    tick(sim, ctrl, {pilot: [{...pilotRecall(sim), commandId: 'bad'}]});
    const all = ctrl.log.query({since: start});
    const kinds = all.events.map(e => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(['autonomy_changed', 'unit_reassigned', 'task', 'command_rejected']));
    expect(all.events.find(e => e.kind === 'unit_reassigned')).toMatchObject({unit: 'U1', target: 'T1', data: {source: 'agent_autonomous'}});
    expect(ctrl.log.query({since: start, kinds: ['task'], unit: 'U1'}).events.every(e => e.kind === 'task' && e.unit === 'U1')).toBe(true);
    expect(ctrl.log.query({since: all.cursor}).events).toEqual([]);
    for (let i = 0; i < 50; i++) ctrl.log.add(sim, 'task', 'filler');
    expect(ctrl.log.query({limit: 500}).events).toHaveLength(20);
  });

  it('is deterministic for identical inputs', () => {
    const go = () => {
      const sim = new Simulation('det'), ctrl = new AgentController();
      setAutonomy(sim, ctrl, true);
      const r = ctrl.submit(sim, {kind: 'squad', assignments: [{unit: 'U1', target: 'T1'}, {unit: 'U2', target: 'T3'}]}, basis(sim));
      if (!r.ok) throw new Error(r.error);
      run(sim, ctrl, 600);
      return JSON.stringify({snap: snapshot(sim), events: ctrl.log.query({limit: 200}).events});
    };
    expect(go()).toBe(go());
  });
});
