/**
 * Read-only, JSON-serialisable view of the battlefield for a supervisor agent.
 *
 * Pure: it copies values out of the Simulation and never writes to it. Numbers are rounded
 * to 2 decimals so snapshots are compact and stable to compare.
 */
import type {Simulation} from '../simulation';
import type {TargetId} from '../contracts';

export type XY = {x: number; y: number};
export interface UnitSnapshot {
  id: string;
  /** 'intercept' = attacking `target`; 'follow' = escorting the pilot (a Recall order). */
  order: 'intercept' | 'follow';
  target: TargetId | null;
  /** 'manual' = from a command (pilot or approved proposal); 'auto' = Fire at Will. */
  origin: 'manual' | 'auto';
  /** Changes whenever the unit receives a new order; use it to detect reassignment. */
  assignment: number;
  /** Assigned by an agent under autonomy (may fire at its own target if the grant includes fire). */
  autonomous: boolean;
  /** 'Moving' | 'At firing position' | 'Following' | 'Blocked: ...' | 'Waiting: ...' */
  status: string;
  blocked: boolean;
  arrived: boolean;
  position: XY;
  destination: XY;
}
export interface TurretSnapshot {
  id: TargetId;
  alive: boolean;
  /** 0-100 */
  health: number;
  /** Armed turrets shoot at the mech. */
  armed: boolean;
  patrolling: boolean;
  position: XY;
  distanceToMech: number;
  /** Units currently ordered to intercept this turret. */
  assignedUnits: string[];
}
export interface EventSnapshot { id: number; tick: number; action: string; outcome: string; detail: string; target: TargetId | null }
export interface GameSnapshot {
  schema: 'GameSnapshot.v1';
  runId: string;
  mode: 'combat' | 'training';
  tick: number;
  /** Seconds since the round started (60 ticks per second). */
  time: number;
  outcome: 'playing' | 'won' | 'lost';
  mech: {health: number; position: XY};
  fire: {
    /** Pilot weapon input is held. */
    pilot: boolean;
    /** Drones are permitted to fire (held Padisarah fire, Fire at Will, or opt-in autofire). */
    padisarahPermitted: boolean;
    /** A drone fired this tick. */
    padisarahFiring: boolean;
    fireAtWill: boolean;
    policy: 'A' | 'B';
  };
  /**
   * Pilot-controlled authority. Send {runId, epoch} back with every decision: if the pilot
   * changes control (Recall, manual order, autonomy / Fire at Will toggle) or retries, the
   * decision is rejected as stale.
   */
  control: {autonomy: boolean; autonomyFire: boolean; epoch: number};
  units: UnitSnapshot[];
  turrets: TurretSnapshot[];
  counts: {turretsAlive: number; turretsTotal: number; accepted: number; rejected: number};
  /** Newest first; the simulation keeps the last 20 semantic events. */
  recentEvents: EventSnapshot[];
  lastHit: {tick: number; target: TargetId; team: 'pilot' | 'funnel'; shooter: string | null} | null;
}

const r = (n: number) => Math.round(n * 100) / 100;
const xy = (p: XY): XY => ({x: r(p.x), y: r(p.y)});

export function snapshot(sim: Simulation, eventLimit = 10): GameSnapshot {
  const assigned = new Map<TargetId, string[]>();
  for (const f of sim.funnels) if (f.order.type === 'INTERCEPT') assigned.set(f.order.targetId, [...(assigned.get(f.order.targetId) ?? []), f.id]);
  const hit = sim.lastHit;
  return {
    schema: 'GameSnapshot.v1',
    runId: sim.runId,
    mode: sim.mode,
    tick: sim.tick,
    time: r(sim.tick / 60),
    outcome: sim.outcome,
    mech: {health: sim.health, position: xy(sim.position)},
    fire: {pilot: sim.pilotFire, padisarahPermitted: sim.padisarahFire, padisarahFiring: sim.padisarahFiring, fireAtWill: sim.fireAtWill, policy: sim.preferredPolicy},
    control: {autonomy: sim.autonomy.enabled, autonomyFire: sim.autonomy.fire, epoch: sim.controlEpoch},
    units: sim.funnels.map(f => ({
      id: f.id,
      order: f.order.type === 'INTERCEPT' ? 'intercept' : 'follow',
      target: f.order.type === 'INTERCEPT' ? f.order.targetId : null,
      origin: f.origin,
      assignment: f.assignment,
      autonomous: f.autonomous,
      status: f.status,
      blocked: f.blocked,
      arrived: Math.hypot(f.position.x - f.destination.x, f.position.y - f.destination.y) < .15,
      position: xy(f.position),
      destination: xy(f.destination),
    })),
    turrets: sim.turrets.map(t => ({
      id: t.id,
      alive: t.health > 0,
      health: Math.max(0, t.health),
      armed: t.armed,
      patrolling: t.patrol.length > 0,
      position: xy(t.position),
      distanceToMech: r(Math.hypot(t.position.x - sim.position.x, t.position.y - sim.position.y)),
      assignedUnits: [...(assigned.get(t.id) ?? [])],
    })),
    counts: {turretsAlive: sim.turrets.filter(t => t.health > 0).length, turretsTotal: sim.turrets.length, accepted: sim.accepted, rejected: sim.rejected},
    recentEvents: sim.events.entries.slice(0, Math.max(0, eventLimit)).map(e => ({id: e.id, tick: e.tick, action: e.action, outcome: e.outcome, detail: e.detail, target: e.target})),
    lastHit: hit ? {tick: hit.tick, target: hit.target, team: hit.team, shooter: hit.shooter ?? null} : null,
  };
}
