/**
 * Bounded, queryable battlefield history for a supervisor agent.
 *
 * Built by comparing successive read-only observations of the Simulation (the game's own
 * RoundEvents keeps only 20 entries and has no "destroyed" or "round started" events).
 * Use `query({since: cursor})` to fetch only what changed since the last look.
 */
import type {Simulation} from '../simulation';
import type {TargetId} from '../contracts';

export type AgentEventKind =
  | 'round_started' | 'round_over'
  | 'turret_destroyed' | 'mech_damaged'
  | 'unit_reassigned' | 'unit_blocked' | 'unit_unblocked'
  | 'recall' | 'command_rejected'
  | 'autonomy_changed' | 'fire_at_will_changed'
  | 'task';

export interface AgentEvent {
  id: number;
  tick: number;
  runId: string;
  kind: AgentEventKind;
  unit: string | null;
  target: TargetId | null;
  /** Short, human-readable summary. */
  detail: string;
  /** Small structured payload for programmatic checks. */
  data: Record<string, string | number | boolean | null>;
}

export interface EventQuery { since?: number; kinds?: AgentEventKind[]; unit?: string; limit?: number }

type SimView = Pick<Simulation, 'runId' | 'tick' | 'outcome' | 'health' | 'funnels' | 'turrets' | 'commandLog' | 'accepted' | 'rejected' | 'autonomy' | 'fireAtWill' | 'lastHit'>;
type UnitMemo = {assignment: number; origin: string; order: string; blocked: boolean};

export class AgentEventLog {
  private events: AgentEvent[] = [];
  private seq = 0;
  private run: string | null = null;
  private units = new Map<string, UnitMemo>();
  private alive = new Map<TargetId, boolean>();
  private health = 100;
  private outcome = 'playing';
  private seenAccepted = 0;
  private seenRejected = 0;
  private autonomy = '';
  private faw = false;

  constructor(readonly capacity = 200) {}

  /** Newest last. `cursor` is the id to pass as `since` next time. */
  query(q: EventQuery = {}): {events: AgentEvent[]; cursor: number} {
    const limit = Math.max(1, Math.min(q.limit ?? 50, this.capacity));
    const matches = this.events.filter(e => e.id > (q.since ?? 0) && (!q.kinds || q.kinds.includes(e.kind)) && (!q.unit || e.unit === q.unit));
    return {events: matches.slice(-limit).map(e => ({...e, data: {...e.data}})), cursor: this.seq};
  }

  get cursor() { return this.seq; }

  add(sim: Pick<SimView, 'runId' | 'tick'>, kind: AgentEventKind, detail: string, extra: {unit?: string | null; target?: TargetId | null; data?: AgentEvent['data']} = {}) {
    const event: AgentEvent = {id: ++this.seq, tick: sim.tick, runId: sim.runId, kind, unit: extra.unit ?? null, target: extra.target ?? null, detail, data: extra.data ?? {}};
    this.events.push(event);
    if (this.events.length > this.capacity) this.events.splice(0, this.events.length - this.capacity);
    return event;
  }

  /** Call once per frame after `sim.step`. Returns the events added by this observation. */
  observe(sim: SimView): AgentEvent[] {
    const start = this.seq;
    if (sim.runId !== this.run) {
      if (this.run !== null) this.add(sim, 'round_started', `New round ${sim.runId} (Retry or restart): previous orders, tasks and authority cleared`, {data: {previousRun: this.run}});
      this.run = sim.runId;
      // A round starts from zero commands, autonomy OFF and Fire at Will OFF; diff everything else from now.
      this.units.clear(); this.alive.clear();
      this.health = sim.health; this.outcome = sim.outcome; this.seenAccepted = 0; this.seenRejected = 0;
      this.autonomy = 'false/false'; this.faw = false;
      for (const t of sim.turrets) this.alive.set(t.id, t.health > 0);
      for (const f of sim.funnels) this.units.set(f.id, this.memo(f));
    }

    for (const t of sim.turrets) {
      const was = this.alive.get(t.id), now = t.health > 0;
      if (was && !now) {
        const hit = sim.lastHit?.target === t.id ? sim.lastHit : null;
        const by = hit ? (hit.team === 'pilot' ? 'pilot' : hit.shooter ?? 'drone') : 'unknown';
        this.add(sim, 'turret_destroyed', `${t.id} destroyed by ${by}`, {target: t.id, unit: hit?.team === 'funnel' ? hit.shooter ?? null : null, data: {by, armed: t.armed}});
      }
      this.alive.set(t.id, now);
    }
    if (sim.health < this.health) this.add(sim, 'mech_damaged', `Mech hit: health ${sim.health}`, {data: {health: sim.health, damage: this.health - sim.health}});
    this.health = sim.health;

    // Accepted commands: Recalls are reported explicitly.
    if (sim.accepted > this.seenAccepted) {
      for (const r of [...sim.commandLog].reverse()) {
        if (r.outcome !== 'accepted' || (r.assignment ?? 0) <= this.seenAccepted) continue;
        if (r.order?.type === 'RECALL') {
          const all = r.group === 'funnels';
          this.add(sim, 'recall', all ? 'Emergency Recall: all units returning, autonomy off' : `${r.units[0]} recalled`, {unit: all ? null : r.units[0] ?? null, data: {scope: all ? 'all' : 'unit', source: r.provenance}});
        }
      }
      this.seenAccepted = sim.accepted;
    }
    if (sim.rejected > this.seenRejected) {
      const fresh = sim.rejected - this.seenRejected;
      for (const r of sim.commandLog.filter(x => x.outcome === 'rejected').slice(0, fresh).reverse())
        this.add(sim, 'command_rejected', `Command rejected: ${r.reason ?? 'invalid'}`, {data: {reason: r.reason ?? null, source: r.provenance, commandId: r.commandId}});
      this.seenRejected = sim.rejected;
    }

    for (const f of sim.funnels) {
      const before = this.units.get(f.id), now = this.memo(f);
      this.units.set(f.id, now);
      if (!before) continue;
      if (before.assignment !== now.assignment || before.order !== now.order) {
        const cause = f.origin === 'manual' ? sim.commandLog.find(r => r.outcome === 'accepted' && r.assignment === f.assignment && r.units.includes(f.id)) : undefined;
        const source = f.origin === 'auto' ? 'fire_at_will' : !cause ? 'system' : cause.provenance === 'local-autonomous' ? 'agent_autonomous' : cause.provenance === 'local-approved-proposal' ? 'agent_approved' : 'pilot';
        const target = f.order.type === 'INTERCEPT' ? f.order.targetId : null;
        const detail = source === 'system' && before.assignment === now.assignment ? `${f.id} returning: assigned target cleared` : `${f.id} → ${target ?? 'follow pilot'} (${source.replace('_', ' ')})`;
        this.add(sim, 'unit_reassigned', detail, {unit: f.id, target, data: {source, order: now.order}});
      }
      if (!before.blocked && now.blocked) this.add(sim, 'unit_blocked', `${f.id} blocked: no route or firing lane`, {unit: f.id, target: f.order.type === 'INTERCEPT' ? f.order.targetId : null});
      if (before.blocked && !now.blocked) this.add(sim, 'unit_unblocked', `${f.id} route found`, {unit: f.id});
    }

    const autonomy = `${sim.autonomy.enabled}/${sim.autonomy.fire}`;
    if (autonomy !== this.autonomy) this.add(sim, 'autonomy_changed', sim.autonomy.enabled ? `Autonomy ON${sim.autonomy.fire ? ' (may fire)' : ' (move only)'}` : 'Autonomy OFF: agent actions need pilot approval', {data: {enabled: sim.autonomy.enabled, fire: sim.autonomy.fire}});
    this.autonomy = autonomy;
    if (sim.fireAtWill !== this.faw) this.add(sim, 'fire_at_will_changed', sim.fireAtWill ? 'Fire at Will ON' : 'Fire at Will OFF', {data: {enabled: sim.fireAtWill}});
    this.faw = sim.fireAtWill;
    if (sim.outcome !== this.outcome) this.add(sim, 'round_over', sim.outcome === 'won' ? 'Arena clear: round won' : 'Mech disabled: round lost', {data: {outcome: sim.outcome}});
    this.outcome = sim.outcome;
    return this.events.slice(this.events.length - Math.min(this.events.length, this.seq - start));
  }

  private memo(f: SimView['funnels'][number]): UnitMemo {
    return {assignment: f.assignment, origin: f.origin, order: f.order.type === 'INTERCEPT' ? f.order.targetId : 'RECALL', blocked: f.blocked};
  }
}
