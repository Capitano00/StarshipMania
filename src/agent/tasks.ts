/**
 * Task lifecycle tracking for supervisor proposals.
 *
 *   proposed ──(pilot approves, envelope queued + accepted)──► accepted ──► executing ──► completed
 *      │                                   │                       │
 *      ├─ dismissed (pilot)                └─ failed (rejected)    ├─ failed (blocked too long, unit lost, round reset)
 *      └─ recalled (Recall before approval)                        ├─ recalled (group or unit Recall)
 *                                                                  └─ superseded (another order / Fire at Will)
 *
 * The tracker only OBSERVES the Simulation (command log, unit assignment numbers, turret
 * health). It never writes to it and is safe to call once per frame after `sim.step`.
 */
import type {Simulation} from '../simulation';
import type {TargetId} from '../contracts';

export type TaskKind = 'intercept' | 'recall';
export type TaskStatus = 'proposed' | 'accepted' | 'executing' | 'completed' | 'failed' | 'recalled' | 'superseded' | 'dismissed';
export const terminalStatuses: readonly TaskStatus[] = ['completed', 'failed', 'recalled', 'superseded', 'dismissed'];
export const isTerminal = (s: TaskStatus) => terminalStatuses.includes(s);

export interface TaskRecord {
  id: string;
  runId: string;
  unit: string;
  kind: TaskKind;
  target: TargetId | null;
  /** Agent-provided reason, stored verbatim for display. */
  reason: string | null;
  status: TaskStatus;
  detail: string | null;
  /** Envelope id once the approved action is queued. */
  commandId: string | null;
  /** The unit's assignment number once accepted. */
  assignment: number | null;
  /** True while executing an intercept at the firing position WITH drone fire permission. */
  firing: boolean;
  createdTick: number;
  updatedTick: number;
  history: {status: TaskStatus; tick: number; detail: string | null}[];
}
export interface TaskEvent { taskId: string; unit: string; kind: TaskKind; target: TargetId | null; status: TaskStatus; tick: number; detail: string | null }
export interface TaskProposal { unit: string; kind: TaskKind; target?: TargetId | null; reason?: string | null }

type SimView = Pick<Simulation, 'runId' | 'tick' | 'funnels' | 'turrets' | 'commandLog' | 'padisarahFire' | 'lastHit' | 'accepted'>;

export class TaskTracker {
  private tasks = new Map<string, TaskRecord>();
  private seq = 0;
  private blockedSince = new Map<string, number>();
  /** sim.accepted when each task was proposed: only commands accepted later can affect a proposal. */
  private acceptedMark = new Map<string, number>();

  /** @param blockLimitTicks how long a unit may stay blocked before its task fails (default 3 s). */
  constructor(readonly blockLimitTicks = 180, readonly maxTasks = 200) {}

  /** Register a proposal. Unknown units/targets are recorded as failed rather than thrown. */
  propose(sim: Pick<SimView, 'runId' | 'tick' | 'funnels' | 'turrets' | 'accepted'>, p: TaskProposal): TaskRecord {
    const task: TaskRecord = {
      id: `task-${++this.seq}`, runId: sim.runId, unit: p.unit, kind: p.kind, target: p.kind === 'intercept' ? p.target ?? null : null,
      reason: p.reason ?? null, status: 'proposed', detail: null, commandId: null, assignment: null, firing: false,
      createdTick: sim.tick, updatedTick: sim.tick, history: [{status: 'proposed', tick: sim.tick, detail: null}],
    };
    this.tasks.set(task.id, task);
    this.acceptedMark.set(task.id, sim.accepted);
    this.prune();
    const problem = !sim.funnels.some(f => f.id === p.unit) ? `Unknown unit ${p.unit}`
      : p.kind === 'intercept' && !sim.turrets.some(t => t.id === p.target && t.health > 0) ? `Target ${p.target ?? '(none)'} not available`
      : null;
    if (problem) this.move(task, 'failed', sim.tick, problem);
    return this.copy(task);
  }

  /** Link a proposal to the envelope queued for it (call when the approved action is queued). */
  bind(taskId: string, commandId: string) {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'proposed' || task.commandId) return false;
    task.commandId = commandId;
    return true;
  }

  dismiss(taskId: string, tick: number, detail = 'Dismissed by pilot') {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'proposed' || task.commandId) return false;
    this.move(task, 'dismissed', tick, detail);
    return true;
  }

  get(taskId: string) { const t = this.tasks.get(taskId); return t ? this.copy(t) : null; }
  list() { return [...this.tasks.values()].map(t => this.copy(t)); }
  active() { return this.list().filter(t => !isTerminal(t.status)); }

  /** Advance every open task from the current simulation state. Returns the transitions. */
  observe(sim: SimView): TaskEvent[] {
    const events: TaskEvent[] = [];
    const emit = (task: TaskRecord, status: TaskStatus, detail: string | null = null) => { if (this.move(task, status, sim.tick, detail)) events.push({taskId: task.id, unit: task.unit, kind: task.kind, target: task.target, status, tick: sim.tick, detail}); };
    for (const task of this.tasks.values()) {
      if (isTerminal(task.status)) continue;
      if (sim.runId !== task.runId) { emit(task, 'failed', 'Round reset (Retry) before completion'); continue; }

      if (task.status === 'proposed') {
        const record = task.commandId ? sim.commandLog.find(r => r.commandId === task.commandId) : undefined;
        if (record?.outcome === 'rejected') { emit(task, 'failed', `Rejected: ${record.reason ?? 'invalid command'}`); continue; }
        if (record?.outcome === 'accepted' && record.assignment !== undefined) { task.assignment = record.assignment; emit(task, 'accepted'); }
        else {
          // A Recall that lands before the proposal was approved cancels it.
          const mark = this.acceptedMark.get(task.id) ?? 0;
          const recall = sim.commandLog.find(r => r.outcome === 'accepted' && r.order?.type === 'RECALL' && (r.assignment ?? 0) > mark && r.units.includes(task.unit));
          if (recall) emit(task, 'recalled', recall.group === 'funnels' ? 'Emergency Recall before approval' : `${task.unit} recalled before approval`);
          continue;
        }
      }

      const unit = sim.funnels.find(f => f.id === task.unit);
      if (!unit) { emit(task, 'failed', 'Unit unavailable'); continue; }
      const owned = unit.assignment === task.assignment && unit.origin === 'manual';
      if (!owned) {
        const cause = unit.origin === 'manual' ? sim.commandLog.find(r => r.outcome === 'accepted' && r.assignment === unit.assignment && r.units.includes(task.unit)) : undefined;
        const targetDown = task.kind === 'intercept' && !sim.turrets.some(t => t.id === task.target && t.health > 0);
        if (cause?.order?.type === 'RECALL' && task.kind === 'intercept') emit(task, 'recalled', cause.group === 'funnels' ? 'Emergency Recall (all units)' : `${task.unit} recalled`);
        else if (targetDown && !cause) emit(task, 'completed', this.destroyedBy(sim, task.target));
        else emit(task, 'superseded', unit.origin === 'auto' ? 'Reassigned by Fire at Will' : cause?.order?.type === 'INTERCEPT' ? `Replaced by order: ${cause.order.targetId}` : cause?.group === 'funnels' ? 'Replaced by Emergency Recall' : 'Replaced by another order');
        continue;
      }

      if (task.kind === 'intercept' && unit.order.type === 'RECALL') {
        // Same assignment but back to follow: the simulation clears an intercept when its target dies.
        const down = !sim.turrets.some(t => t.id === task.target && t.health > 0);
        emit(task, down ? 'completed' : 'superseded', down ? this.destroyedBy(sim, task.target) : 'Order cleared');
        continue;
      }
      if (unit.blocked) {
        const since = this.blockedSince.get(task.id) ?? sim.tick;
        this.blockedSince.set(task.id, since);
        if (sim.tick - since >= this.blockLimitTicks) { emit(task, 'failed', task.kind === 'intercept' ? 'Blocked: no reachable route or firing lane' : 'Blocked: no route back to the pilot'); continue; }
        if (task.status === 'accepted') emit(task, 'executing', 'Blocked: retrying route');
        task.detail = 'Blocked: retrying route';
        task.firing = false;
        continue;
      }
      this.blockedSince.delete(task.id);
      if (task.kind === 'intercept') {
        const atPosition = unit.status === 'At firing position';
        task.firing = atPosition && sim.padisarahFire;
        if (task.status === 'accepted') emit(task, 'executing', atPosition ? null : 'Moving to firing position');
        task.detail = atPosition ? (sim.padisarahFire ? 'Engaging' : 'Holding fire: no drone fire permission') : 'Moving to firing position';
      } else {
        if (task.status === 'accepted') emit(task, 'executing', 'Returning to pilot');
        if (unit.status === 'Following') emit(task, 'completed', 'Back in escort formation');
      }
    }
    return events;
  }

  private destroyedBy(sim: SimView, target: TargetId | null) {
    const hit = sim.lastHit;
    if (hit && hit.target === target) return `${target} destroyed by ${hit.team === 'pilot' ? 'pilot' : hit.shooter ?? 'drone'}`;
    return `${target} destroyed`;
  }

  private move(task: TaskRecord, status: TaskStatus, tick: number, detail: string | null) {
    if (task.status === status && status !== 'proposed') return false;
    task.status = status; task.detail = detail; task.updatedTick = tick;
    if (isTerminal(status)) task.firing = false;
    task.history.push({status, tick, detail});
    if (task.history.length > 20) task.history.splice(1, task.history.length - 20);
    return true;
  }

  private prune() {
    if (this.tasks.size <= this.maxTasks) return;
    for (const [id, t] of this.tasks) { if (this.tasks.size <= this.maxTasks) break; if (isTerminal(t.status)) { this.tasks.delete(id); this.blockedSince.delete(id); this.acceptedMark.delete(id); } }
  }

  private copy(t: TaskRecord): TaskRecord { return {...t, history: t.history.map(h => ({...h}))}; }
}
