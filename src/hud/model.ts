/** Pure mapping from read-only simulation state to HUD view models. No DOM, no mutation. */
import type {Simulation} from '../simulation';
import type {TargetId} from '../contracts';
import type {RoundEvent} from '../round-events';
import type {DroneHud, DroneState, DroneTelemetry, HudEvent, HudSeverity, ObjectiveHud} from './contract';

type Funnel = Simulation['funnels'][number];

export function droneState(f: Funnel): DroneState {
  if (f.blocked || f.status.startsWith('Blocked')) return 'blocked';
  if (f.status.startsWith('Waiting')) return 'standby';
  if (f.order.type === 'INTERCEPT') return f.status === 'Moving' ? 'moving' : 'engaging';
  return f.status === 'Moving' ? 'returning' : 'following';
}

export function droneCards(sim: Simulation, telemetry: Record<string, DroneTelemetry> = {}): DroneHud[] {
  return sim.funnels.map(f => {
    const state = droneState(f), extra = telemetry[f.id] ?? {};
    const targetId = f.order.type === 'INTERCEPT' ? f.order.targetId : undefined;
    const target = targetId ? sim.turrets.find(t => t.id === targetId) : undefined;
    const label = extra.taskLabel ?? (
      state === 'blocked' ? (targetId ? `BLOCKED · ${targetId}` : 'BLOCKED · NO ROUTE')
      : state === 'standby' ? 'STANDBY · NO ELIGIBLE TARGET'
      : state === 'moving' ? `INTERCEPT · ${targetId}`
      : state === 'engaging' ? `ENGAGING · ${targetId}`
      : state === 'returning' ? 'RECALL · RETURNING'
      : 'ESCORT · PILOT');
    return {
      id: f.id, callsign: f.id, state,
      task: {kind: targetId ? 'intercept' : state === 'standby' ? 'standby' : state === 'returning' ? 'recall' : 'follow', label, targetId},
      authority: extra.authority ?? (f.autonomous ? 'agent' : f.origin === 'auto' ? 'auto' : 'pilot'),
      targetHull: target ? Math.max(0, target.health) / 100 : null,
      health: extra.health ?? null,
      reason: extra.reason,
    };
  });
}

export function objectives(sim: Simulation, preview: TargetId | null): ObjectiveHud[] {
  const assigned = new Set(sim.funnels.flatMap(f => f.order.type === 'INTERCEPT' ? [f.order.targetId] : []));
  return sim.turrets.map(t => ({
    id: t.id, hull: Math.max(0, t.health) / 100,
    state: t.health <= 0 ? 'down' : preview === t.id ? 'locked' : assigned.has(t.id) ? 'assigned' : t.armed ? 'armed' : 'idle',
  }));
}

export function eventSeverity(e: Pick<RoundEvent, 'action' | 'outcome'>): HudSeverity {
  if (e.action === 'Recall' && e.outcome === 'Accepted') return 'critical';
  if (e.action === 'Autonomy') return e.outcome === 'Enabled' ? 'success' : 'warn';
  if (/^(Rejected|Cancelled|Blocked)/.test(e.outcome)) return 'warn';
  if (/^(Accepted|Started|Enabled|Finished)/.test(e.outcome)) return 'success';
  return 'info';
}

export function toHudEvent(e: RoundEvent): HudEvent {
  return {id: 'sim-' + e.id, tick: e.tick, source: e.action === 'Auto assignment' ? 'system' : 'pilot',
    title: `${e.action}${e.target ? ' · ' + e.target : ''}`.toUpperCase(), detail: `${e.outcome}${e.detail ? ' · ' + e.detail : ''}`, severity: eventSeverity(e)};
}

/** Which simulation events deserve a transient on-screen acknowledgement. */
export function toastWorthy(e: RoundEvent) {
  return ['Recall', 'Deploy / redirect', 'Command', 'Fire at will', 'Unit deploy', 'Unit recall', 'Squad deploy', 'Autonomy'].includes(e.action) && e.outcome !== 'Finished';
}

export const formatTime = (tick: number) => (tick / 60).toFixed(1).padStart(4, '0') + 's';
