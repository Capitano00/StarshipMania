import {describe, expect, it} from 'vitest';
import {Simulation} from '../src/simulation';
import {neutralFrame, type CommandGroup, type Order, type PilotControlFrame} from '../src/contracts';
import {snapshot} from '../src/agent/snapshot';
import {TaskTracker, type TaskEvent} from '../src/agent/tasks';

let id = 0;
const env = (s: Simulation, order: Order, group: CommandGroup, provenance: Parameters<Simulation['envelope']>[1] = 'local-approved-proposal') =>
  s.envelope(order, provenance, `cmd-${++id}`, group);
const frame = (padisarahFire = false): PilotControlFrame => ({...neutralFrame(), padisarahFire});
/** Approve a proposal: queue its envelope NOW (fresh id/tick) and bind it to the task. */
const approve = (s: Simulation, tracker: TaskTracker, taskId: string, order: Order, group: CommandGroup) => {
  const e = env(s, order, group); tracker.bind(taskId, e.commandId); return e;
};
const run = (s: Simulation, tracker: TaskTracker, ticks: number, opts: {commands?: unknown[]; fire?: boolean} = {}) => {
  const events: TaskEvent[] = [];
  s.step(frame(opts.fire), opts.commands ?? []); events.push(...tracker.observe(s));
  for (let i = 1; i < ticks && s.outcome === 'playing'; i++) { s.step(frame(opts.fire)); events.push(...tracker.observe(s)); }
  return events;
};
const statuses = (events: TaskEvent[], taskId: string) => events.filter(e => e.taskId === taskId).map(e => e.status);

describe('read-only game snapshot', () => {
  it('is JSON-serialisable, deep-copied and reflects per-unit orders', () => {
    const s = new Simulation('snap');
    s.step(neutralFrame(), [env(s, {type: 'INTERCEPT', targetId: 'T1'}, 'U1'), env(s, {type: 'INTERCEPT', targetId: 'T3'}, 'U2')]);
    s.turrets.find(t => t.id === 'T6')!.health = 0;
    const snap = snapshot(s);
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
    expect(snap).toMatchObject({schema: 'GameSnapshot.v1', runId: 'snap', mode: 'combat', outcome: 'playing', mech: {health: 100}});
    expect(snap.units.map(u => [u.id, u.order, u.target, u.origin])).toEqual([['U1', 'intercept', 'T1', 'manual'], ['U2', 'intercept', 'T3', 'manual']]);
    expect(snap.turrets.find(t => t.id === 'T1')).toMatchObject({alive: true, armed: true, assignedUnits: ['U1']});
    expect(snap.turrets.find(t => t.id === 'T6')).toMatchObject({alive: false, health: 0, patrolling: true});
    expect(snap.counts).toMatchObject({turretsAlive: 5, turretsTotal: 6});
    expect(snap.recentEvents[0]).toMatchObject({action: 'Unit deploy', outcome: 'Accepted'});
    expect(snap.fire).toEqual({pilot: false, padisarahPermitted: false, padisarahFiring: false, fireAtWill: false, policy: 'A'});

    snap.units[0].target = 'T5'; snap.turrets[0].health = 1; snap.mech.position.x = 99;
    expect(s.funnels[0].order).toEqual({type: 'INTERCEPT', targetId: 'T1'});
    expect(s.turrets[0].health).toBe(100);
    expect(s.position.x).toBe(0);
  });

  it('does not change simulation state', () => {
    const a = new Simulation('same'), b = new Simulation('same');
    for (let i = 0; i < 120; i++) { a.step(neutralFrame()); snapshot(a); b.step(neutralFrame()); }
    expect(JSON.stringify(snapshot(a))).toBe(JSON.stringify(snapshot(b)));
  });
});

describe('task lifecycle', () => {
  it('proposed → accepted → executing, reporting when drones hold fire for lack of permission', () => {
    const s = new Simulation('t1'), tracker = new TaskTracker();
    const task = tracker.propose(s, {unit: 'U1', kind: 'intercept', target: 'T1', reason: 'Nearest armed turret'});
    expect(task).toMatchObject({status: 'proposed', reason: 'Nearest armed turret'});
    expect(tracker.observe(s)).toEqual([]);
    const events = run(s, tracker, 400, {commands: [approve(s, tracker, task.id, {type: 'INTERCEPT', targetId: 'T1'}, 'U1')]});
    expect(statuses(events, task.id)).toEqual(['accepted', 'executing']);
    expect(tracker.get(task.id)).toMatchObject({status: 'executing', firing: false, detail: 'Holding fire: no drone fire permission'});
    expect(s.funnels[1].order.type).toBe('RECALL');
  });

  it('completes when the drone actually destroys its target', () => {
    const s = new Simulation('t2'), tracker = new TaskTracker();
    s.turrets.forEach(t => t.armed = false); // keep the mech alive for a long deterministic run
    const task = tracker.propose(s, {unit: 'U1', kind: 'intercept', target: 'T4'});
    const events = run(s, tracker, 3000, {fire: true, commands: [approve(s, tracker, task.id, {type: 'INTERCEPT', targetId: 'T4'}, 'U1')]});
    expect(statuses(events, task.id)).toEqual(['accepted', 'executing', 'completed']);
    expect(tracker.get(task.id)?.detail).toMatch(/^T4 destroyed by (U1|U2|drone)$/);
    expect(s.turrets.find(t => t.id === 'T4')!.health).toBe(0);
  });

  it('is recalled by a unit Recall or by the emergency Recall; the other unit keeps its task', () => {
    const s = new Simulation('t3'), tracker = new TaskTracker();
    const a = tracker.propose(s, {unit: 'U1', kind: 'intercept', target: 'T1'}), b = tracker.propose(s, {unit: 'U2', kind: 'intercept', target: 'T3'});
    run(s, tracker, 5, {commands: [approve(s, tracker, a.id, {type: 'INTERCEPT', targetId: 'T1'}, 'U1'), approve(s, tracker, b.id, {type: 'INTERCEPT', targetId: 'T3'}, 'U2')]});
    run(s, tracker, 2, {commands: [env(s, {type: 'RECALL'}, 'U1')]});
    expect(tracker.get(a.id)).toMatchObject({status: 'recalled', detail: 'U1 recalled'});
    expect(tracker.get(b.id)?.status).toBe('executing');
    run(s, tracker, 2, {commands: [env(s, {type: 'RECALL'}, 'funnels', 'local-keyboard-recall')]});
    expect(tracker.get(b.id)).toMatchObject({status: 'recalled', detail: 'Emergency Recall (all units)'});
  });

  it('is superseded by a new order for the same unit or by Fire at Will', () => {
    const s = new Simulation('t4'), tracker = new TaskTracker();
    const a = tracker.propose(s, {unit: 'U1', kind: 'intercept', target: 'T1'});
    run(s, tracker, 3, {commands: [approve(s, tracker, a.id, {type: 'INTERCEPT', targetId: 'T1'}, 'U1')]});
    run(s, tracker, 2, {commands: [env(s, {type: 'INTERCEPT', targetId: 'T2'}, 'U1', 'local-hand-commit')]});
    expect(tracker.get(a.id)).toMatchObject({status: 'superseded', detail: 'Replaced by order: T2'});

    const b = tracker.propose(s, {unit: 'U2', kind: 'intercept', target: 'T3'});
    run(s, tracker, 3, {commands: [approve(s, tracker, b.id, {type: 'INTERCEPT', targetId: 'T3'}, 'U2')]});
    s.step(neutralFrame(), [], false, [s.intent({type: 'DRONE_POLICY', enabled: true, mode: 'A'})]);
    tracker.observe(s);
    expect(tracker.get(b.id)).toMatchObject({status: 'superseded', detail: 'Reassigned by Fire at Will'});
  });

  it('fails on rejection, unknown units, dead targets, long blocks and round reset', () => {
    const s = new Simulation('t5'), tracker = new TaskTracker(60);
    expect(tracker.propose(s, {unit: 'U7', kind: 'intercept', target: 'T1'})).toMatchObject({status: 'failed', detail: 'Unknown unit U7'});
    s.turrets[1].health = 0;
    expect(tracker.propose(s, {unit: 'U1', kind: 'intercept', target: 'T2'})).toMatchObject({status: 'failed', detail: 'Target T2 not available'});

    // Approved too late: the envelope expired before it reached the simulation.
    const late = tracker.propose(s, {unit: 'U1', kind: 'intercept', target: 'T1'});
    const stale = approve(s, tracker, late.id, {type: 'INTERCEPT', targetId: 'T1'}, 'U1');
    for (let i = 0; i < 20; i++) s.step(neutralFrame());
    run(s, tracker, 1, {commands: [stale]});
    expect(tracker.get(late.id)).toMatchObject({status: 'failed', detail: 'Rejected: Expired or invalid timing'});

    const blocked = tracker.propose(s, {unit: 'U2', kind: 'intercept', target: 'T3'});
    run(s, tracker, 2, {commands: [approve(s, tracker, blocked.id, {type: 'INTERCEPT', targetId: 'T3'}, 'U2')]});
    s.funnels[1].blocked = true; tracker.observe(s);
    s.tick += 61; s.funnels[1].blocked = true; tracker.observe(s);
    expect(tracker.get(blocked.id)).toMatchObject({status: 'failed', detail: 'Blocked: no reachable route or firing lane'});

    const open = tracker.propose(s, {unit: 'U1', kind: 'intercept', target: 'T3'});
    tracker.observe(new Simulation('t5-retry'));
    expect(tracker.get(open.id)).toMatchObject({status: 'failed', detail: 'Round reset (Retry) before completion'});
  });

  it('a Recall before approval cancels the proposal; an earlier Recall does not', () => {
    const s = new Simulation('t6'), tracker = new TaskTracker();
    run(s, tracker, 1, {commands: [env(s, {type: 'RECALL'}, 'funnels', 'local-keyboard-recall')]});
    const task = tracker.propose(s, {unit: 'U1', kind: 'intercept', target: 'T1'});
    tracker.observe(s);
    expect(tracker.get(task.id)?.status).toBe('proposed');
    run(s, tracker, 1, {commands: [env(s, {type: 'RECALL'}, 'funnels', 'local-keyboard-recall')]});
    expect(tracker.get(task.id)).toMatchObject({status: 'recalled', detail: 'Emergency Recall before approval'});
    expect(tracker.bind(task.id, 'cmd-999999')).toBe(false);
  });

  it('dismissal only applies to open, unqueued proposals', () => {
    const s = new Simulation('t7'), tracker = new TaskTracker();
    const a = tracker.propose(s, {unit: 'U1', kind: 'intercept', target: 'T1'});
    expect(tracker.dismiss(a.id, s.tick)).toBe(true);
    expect(tracker.get(a.id)?.status).toBe('dismissed');
    const b = tracker.propose(s, {unit: 'U1', kind: 'intercept', target: 'T1'});
    tracker.bind(b.id, 'cmd-5');
    expect(tracker.dismiss(b.id, s.tick)).toBe(false);
  });

  it('a unit-recall task completes when the unit is back in escort formation', () => {
    const s = new Simulation('t8'), tracker = new TaskTracker();
    run(s, tracker, 60, {commands: [env(s, {type: 'INTERCEPT', targetId: 'T1'}, 'U2', 'local-hand-commit')]});
    const task = tracker.propose(s, {unit: 'U2', kind: 'recall', reason: 'Escort the pilot'});
    const events = run(s, tracker, 900, {commands: [approve(s, tracker, task.id, {type: 'RECALL'}, 'U2')]});
    expect(statuses(events, task.id)).toEqual(['accepted', 'executing', 'completed']);
    expect(tracker.get(task.id)?.detail).toBe('Back in escort formation');
  });
});
