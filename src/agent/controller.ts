/**
 * AgentController: the only path from a supervisor decision to the simulation.
 *
 *   model decision ──submit(action, basis)──►  autonomy OFF: proposal awaiting pilot approve()/dismiss()
 *                                             autonomy ON : queued as an autonomous order
 *   frame loop: envelopes = controller.drain(sim)  → sim.step(frame, [...pilotCommands, ...envelopes])
 *               controller.observe(sim)            ← after the step
 *
 * Safety properties:
 * - The model never touches the Simulation: it can only submit actions. Every envelope is created
 *   in drain(), at queue time, with a fresh id, the current run id and the current tick, and is
 *   validated again by the simulation (Recall precedence, authority, expiry, targets).
 * - Decisions carry the {runId, epoch} of the snapshot they were based on. A Retry, an emergency
 *   Recall, a manual pilot order or an autonomy / Fire at Will toggle changes them, so late
 *   decisions are rejected as stale and cannot resurrect cancelled work.
 * - Emergency Recall and Retry cancel every pending proposal and queued action.
 * - Deterministic and synchronous: no timers, no network, no model calls.
 */
import type {Simulation} from '../simulation';
import type {CommandEnvelope, SquadOrder, TargetId, UnitId} from '../contracts';
import {snapshot} from './snapshot';
import {TaskTracker, type TaskRecord} from './tasks';
import {AgentEventLog, type AgentEvent} from './events';

export type AgentAction =
  | {kind: 'intercept'; unit: string; target: TargetId; reason?: string}
  | {kind: 'recall'; unit: string; reason?: string}
  | {kind: 'defend'; unit: string; reason?: string}
  | {kind: 'squad'; assignments: {unit: string; target: TargetId}[]; reason?: string};

/** Copy from GameSnapshot: {runId: snap.runId, epoch: snap.control.epoch}. */
export interface DecisionBasis { runId: string; epoch: number }

export type SubmitResult =
  | {ok: true; proposalId: string; taskIds: string[]; mode: 'awaiting_approval' | 'queued_autonomous'; resolved: ResolvedAction}
  | {ok: false; code: 'stale' | 'invalid' | 'unavailable'; error: string};

/** Actions after defend_pilot resolution: only intercepts, unit recalls and squads reach the simulation. */
export type ResolvedAction =
  | {kind: 'intercept'; unit: string; target: TargetId}
  | {kind: 'recall'; unit: string}
  | {kind: 'squad'; assignments: {unit: string; target: TargetId}[]};

export type ProposalStatus = 'awaiting_approval' | 'queued' | 'sent' | 'dismissed' | 'cancelled';
export interface Proposal {
  id: string; runId: string; status: ProposalStatus; resolved: ResolvedAction; reason: string | null;
  autonomous: boolean; taskIds: string[]; basis: DecisionBasis; createdTick: number; detail: string | null; commandId: string | null;
}

type Sim = Simulation;
const AGENT_ID_BASE = 900_000_000; // disjoint from main.ts command ids (cmd-1, cmd-2, ...)

export class AgentController {
  readonly tasks: TaskTracker;
  readonly log: AgentEventLog;
  private proposals = new Map<string, Proposal>();
  private queue: string[] = [];
  private seq = 0;
  private nextCommand = AGENT_ID_BASE;
  private run: string | null = null;
  private lastAccepted = 0;

  constructor(options: {blockLimitTicks?: number; eventCapacity?: number} = {}) {
    this.tasks = new TaskTracker(options.blockLimitTicks ?? 180);
    this.log = new AgentEventLog(options.eventCapacity ?? 200);
  }

  /** The basis a decision made from this simulation state should carry. */
  static basis(sim: Pick<Sim, 'runId' | 'controlEpoch'>): DecisionBasis { return {runId: sim.runId, epoch: sim.controlEpoch}; }

  /** Validate a model decision against the CURRENT state and turn it into a proposal or an autonomous order. */
  submit(sim: Sim, action: AgentAction, basis: DecisionBasis, options?: { requireApproval?: boolean }): SubmitResult {
    if (!basis || basis.runId !== sim.runId) return {ok: false, code: 'stale', error: 'Stale decision: the round changed (Retry) since that snapshot. Fetch a new game state.'};
    if (basis.epoch !== sim.controlEpoch) return {ok: false, code: 'stale', error: 'Stale decision: the pilot changed control (Recall, manual order or autonomy) since that snapshot. Fetch a new game state.'};
    if (sim.mode !== 'combat') return {ok: false, code: 'unavailable', error: 'Agent orders are unavailable in guided practice.'};
    if (sim.outcome !== 'playing') return {ok: false, code: 'unavailable', error: `The round is over (${sim.outcome}).`};
    const resolved = this.resolve(sim, action);
    if ('error' in resolved) return {ok: false, code: 'invalid', error: resolved.error};
    const reason = typeof action.reason === 'string' ? action.reason.slice(0, 160) : null;
    const units = resolved.kind === 'squad' ? resolved.assignments.map(a => a.unit) : [resolved.unit];

    // A newer decision replaces older unapproved proposals for the same units.
    for (const p of this.proposals.values()) if (p.status === 'awaiting_approval' && this.unitsOf(p.resolved).some(u => units.includes(u))) this.close(p, 'dismissed', sim.tick, 'Superseded by a newer proposal');

    const autonomous = sim.autonomy.enabled && !options?.requireApproval;
    const taskIds = (resolved.kind === 'squad' ? resolved.assignments.map(a => ({unit: a.unit, kind: 'intercept' as const, target: a.target}))
      : resolved.kind === 'intercept' ? [{unit: resolved.unit, kind: 'intercept' as const, target: resolved.target}]
      : [{unit: resolved.unit, kind: 'recall' as const}]).map(t => this.tasks.propose(sim, {...t, reason}).id);
    const proposal: Proposal = {id: `proposal-${++this.seq}`, runId: sim.runId, status: autonomous ? 'queued' : 'awaiting_approval', resolved, reason, autonomous, taskIds, basis: {...basis}, createdTick: sim.tick, detail: null, commandId: null};
    this.proposals.set(proposal.id, proposal);
    if (autonomous) this.queue.push(proposal.id);
    return {ok: true, proposalId: proposal.id, taskIds: [...taskIds], mode: autonomous ? 'queued_autonomous' : 'awaiting_approval', resolved: structuredClone(resolved)};
  }

  /** Pilot approves a proposal: it is queued and sent on the next drain(). */
  approve(proposalId: string, sim: Pick<Sim, 'runId'>): {ok: boolean; error?: string} {
    const p = this.proposals.get(proposalId);
    if (!p || p.status !== 'awaiting_approval') return {ok: false, error: 'Proposal is not awaiting approval.'};
    if (p.runId !== sim.runId) return {ok: false, error: 'Proposal belongs to a previous round.'};
    if (p.taskIds.some(id => this.tasks.get(id)?.status !== 'proposed')) return {ok: false, error: 'Proposal is no longer valid (cancelled by Recall or the battlefield changed).'};
    p.status = 'queued';
    this.queue.push(p.id);
    return {ok: true};
  }

  dismiss(proposalId: string, tick: number): boolean {
    const p = this.proposals.get(proposalId);
    if (!p || p.status !== 'awaiting_approval') return false;
    this.close(p, 'dismissed', tick, 'Dismissed by pilot');
    return true;
  }

  /** Proposals the HUD should show for Accept / Dismiss. */
  pending(): Proposal[] { return [...this.proposals.values()].filter(p => p.status === 'awaiting_approval').map(p => structuredClone(p)); }
  proposal(id: string): Proposal | null { const p = this.proposals.get(id); return p ? structuredClone(p) : null; }

  /** Call in the frame loop immediately BEFORE sim.step. Returns fresh envelopes to pass to step. */
  drain(sim: Sim): CommandEnvelope[] {
    const out: CommandEnvelope[] = [];
    for (const id of this.queue.splice(0)) {
      const p = this.proposals.get(id);
      if (!p || p.status !== 'queued') continue;
      if (p.runId !== sim.runId) continue; // never sent; observe() records the Retry cancellation
      if (p.autonomous && !sim.autonomy.enabled) { this.close(p, 'cancelled', sim.tick, 'Autonomy switched off before execution'); continue; }
      if (p.autonomous && p.basis.epoch !== sim.controlEpoch) { this.close(p, 'cancelled', sim.tick, 'Pilot changed control before execution'); continue; }
      if (p.taskIds.some(t => this.tasks.get(t)?.status !== 'proposed')) { this.close(p, 'cancelled', sim.tick, 'Cancelled before execution'); continue; }
      const provenance = p.autonomous ? 'local-autonomous' : 'local-approved-proposal';
      const commandId = `cmd-${++this.nextCommand}`;
      const r = p.resolved;
      const envelope: CommandEnvelope = r.kind === 'squad'
        ? {...sim.envelope({type: 'RECALL'}, provenance, commandId, 'funnels'), payload: {type: 'SQUAD', assignments: r.assignments.map(a => ({unit: a.unit as UnitId, targetId: a.target}))} satisfies SquadOrder}
        : sim.envelope(r.kind === 'intercept' ? {type: 'INTERCEPT', targetId: r.target} : {type: 'RECALL'}, provenance, commandId, r.unit as UnitId);
      for (const t of p.taskIds) this.tasks.bind(t, commandId);
      p.status = 'sent'; p.commandId = commandId;
      out.push(envelope);
    }
    return out;
  }

  /** Call once per frame immediately AFTER sim.step. Returns new history events (including task transitions). */
  observe(sim: Sim): AgentEvent[] {
    const before = this.log.cursor;
    this.log.observe(sim);
    // Tasks first, so Recall / Retry show up as 'recalled' / 'failed' rather than 'dismissed'.
    for (const e of this.tasks.observe(sim)) this.log.add(sim, 'task', `${e.unit} task ${e.status}${e.detail ? ': ' + e.detail : ''}`, {unit: e.unit, target: e.target, data: {taskId: e.taskId, status: e.status, kind: e.kind}});
    // Emergency Recall or Retry: cancel every pending proposal and queued action.
    const retried = this.run !== null && sim.runId !== this.run;
    const emergency = sim.commandLog.some(r => r.outcome === 'accepted' && r.order?.type === 'RECALL' && r.group === 'funnels' && (r.assignment ?? 0) > this.lastAccepted);
    if (retried || emergency) for (const p of this.proposals.values()) if (p.status === 'awaiting_approval' || p.status === 'queued') this.close(p, 'cancelled', sim.tick, retried ? 'Round changed (Retry)' : 'Emergency Recall');
    this.run = sim.runId; this.lastAccepted = sim.accepted;
    return this.log.query({since: before, limit: 200}).events;
  }

  task(taskId: string): TaskRecord | null { return this.tasks.get(taskId); }

  private resolve(sim: Sim, action: AgentAction): ResolvedAction | {error: string} {
    const unitOk = (u: unknown): u is string => typeof u === 'string' && sim.funnels.some(f => f.id === u);
    const alive = (t: unknown): t is TargetId => sim.turrets.some(x => x.id === t && x.health > 0);
    if (!action || typeof action !== 'object') return {error: 'Invalid action.'};
    switch (action.kind) {
      case 'intercept':
        if (!unitOk(action.unit)) return {error: `Unknown unit ${String(action.unit)}.`};
        if (!alive(action.target)) return {error: `Target ${String(action.target)} is not available (destroyed or unknown).`};
        return {kind: 'intercept', unit: action.unit, target: action.target};
      case 'recall':
        if (!unitOk(action.unit)) return {error: `Unknown unit ${String(action.unit)}.`};
        return {kind: 'recall', unit: action.unit};
      case 'defend': {
        if (!unitOk(action.unit)) return {error: `Unknown unit ${String(action.unit)}.`};
        const threat = nearestArmedTurret(sim);
        if (!threat) return {error: 'No armed turret is left to defend against.'};
        return {kind: 'intercept', unit: action.unit, target: threat};
      }
      case 'squad': {
        const list = Array.isArray(action.assignments) ? action.assignments : [];
        if (list.length < 1 || list.length > sim.funnels.length) return {error: `A squad plan needs 1-${sim.funnels.length} assignments.`};
        const seen = new Set<string>();
        for (const a of list) {
          if (!a || !unitOk(a.unit)) return {error: `Unknown unit ${String(a?.unit)}.`};
          if (seen.has(a.unit)) return {error: `Unit ${a.unit} appears twice in the plan.`};
          if (!alive(a.target)) return {error: `Target ${String(a.target)} is not available (destroyed or unknown).`};
          seen.add(a.unit);
        }
        return {kind: 'squad', assignments: list.map(a => ({unit: a.unit, target: a.target}))};
      }
      default: return {error: `Unknown action kind ${String((action as {kind?: unknown}).kind)}.`};
    }
  }

  private unitsOf(r: ResolvedAction) { return r.kind === 'squad' ? r.assignments.map(a => a.unit) : [r.unit]; }

  private close(p: Proposal, status: 'dismissed' | 'cancelled', tick: number, detail: string) {
    p.status = status; p.detail = detail;
    for (const t of p.taskIds) this.tasks.dismiss(t, tick, detail);
  }
}

/** Nearest living, armed turret to the mech, from the read-only snapshot (ties broken by id). */
export function nearestArmedTurret(sim: Sim): TargetId | null {
  const threats = snapshot(sim, 0).turrets.filter(t => t.alive && t.armed).sort((a, b) => a.distanceToMech - b.distanceToMech || a.id.localeCompare(b.id));
  return threats[0]?.id ?? null;
}
