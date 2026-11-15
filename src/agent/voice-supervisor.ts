import { targetIds, type TargetId } from '../contracts';
import type { Simulation } from '../simulation';
import { nearestArmedTurret } from './controller';
import type { OrderAssignment, OrderQueue } from './order-queue';
import type { OrderQueuePending } from '../hud/order-queue';
import { requestDroneWorkers, type WorkerRequest } from './drone-worker-contract';
import { validate, type JsonSchema } from './tools';

const units = ['U1', 'U2'] as const;
const token: JsonSchema = { type: 'string', maxLength: 64 };
const turretId: JsonSchema = { type: 'string', enum: targetIds };
export const voiceSupervisorSpecs = [
  {
    name: 'plan_drone_assignment',
    description: 'Propose a direct, squad, defend, far or near assignment. Ask the pilot to review it in Orders. Requires a fresh state token.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['intent', 'timing', 'state_token'],
      properties: {
        intent: { type: 'string', enum: ['direct', 'far', 'near', 'defend', 'squad'] },
        timing: { type: 'string', enum: ['now', 'when_feasible'] },
        unit: { type: 'string', enum: units },
        target: turretId,
        u1_target: turretId,
        u2_target: turretId,
        state_token: token,
      },
    } satisfies JsonSchema,
  },
  {
    name: 'request_unit_recall',
    description: 'Propose returning one named drone to escort the pilot. This requires confirmation in Orders.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['unit', 'state_token'],
      properties: { unit: { type: 'string', enum: units }, state_token: token },
    } satisfies JsonSchema,
  },
  {
    name: 'get_order_queue',
    description: 'Read the current order queue and stable order IDs.',
    input_schema: { type: 'object', additionalProperties: false } satisfies JsonSchema,
  },
  {
    name: 'request_queue_change',
    description: 'Offer to promote or cancel a waiting order by ID. The change requires pilot confirmation in Orders.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['id', 'operation', 'state_token'],
      properties: { id: { type: 'string', maxLength: 32 }, operation: { type: 'string', enum: ['promote', 'cancel'] }, state_token: token },
    } satisfies JsonSchema,
  },
] as const;

type Pending = (
  | (Omit<OrderQueuePending, 'assignments'> & { kind: 'assignment'; assignments: OrderAssignment[]; deferred: boolean; unitRevisions: number[] })
  | (OrderQueuePending & { kind: 'unit-recall'; unit: OrderAssignment['unit']; unitRevision: number })
  | (OrderQueuePending & { kind: 'promote' | 'cancel'; orderId: string })
) & { stateToken: string };

export type VoiceOrderOutcome = 'Awaiting approval' | 'Approved' | 'Accepted' | 'Waiting' | 'Rejected' | 'Cancelled';
export const describeVoiceAssignments = (assignments: OrderAssignment[]) =>
  assignments.map(({unit, target}) => unit + ' to ' + target).join(' · ');

interface Context {
  current: () => Simulation | null;
  queue: OrderQueue;
  submit: (sim: Simulation, assignments: OrderAssignment[], reason: string) => boolean;
  submitRecall: (sim: Simulation, unit: OrderAssignment['unit'], reason: string) => boolean;
  notify: (message: string, outcome: VoiceOrderOutcome) => void;
  workers?: typeof requestDroneWorkers;
}

const stateToken = (sim: Simulation) => `${sim.runId}@${sim.controlEpoch}`;
const unavailable = (error: string) => ({ ok: false, error });
const idle = (sim: Simulation, unit: string) => sim.funnels.find(drone => drone.id === unit)?.order.type === 'RECALL';

export function createVoiceSupervisor(context: Context) {
  let pending: Pending | null = null;
  let generation = 0;
  let request: AbortController | null = null;
  const current = () => {
    const sim = context.current();
    return sim?.mode === 'combat' && sim.outcome === 'playing' ? sim : null;
  };

  function clear() {
    generation++;
    request?.abort();
    request = null;
    pending = null;
  }

  function offer(sim: Simulation, assignments: OrderAssignment[], reason: string, deferred: boolean) {
    const busy = assignments.filter(a => !idle(sim, a.unit));
    const currentTask = busy.map(a => {
      const order = sim.funnels.find(drone => drone.id === a.unit)?.order;
      return order?.type === 'INTERCEPT' ? `${a.unit} is assigned to ${order.targetId}` : '';
    }).filter(Boolean).join(' · ');
    pending = {
      id: `voice-plan-${generation}`, kind: 'assignment', stateToken: stateToken(sim),
      title: deferred ? 'Queue when feasible' : busy.length ? 'Replace drone assignments' : assignments.length > 1 ? 'Confirm squad assignment' : 'Confirm drone assignment',
      assignments, reason, deferred, unitRevisions: assignments.map(a => sim.funnels.find(drone => drone.id === a.unit)!.assignment),
      currentTask, confirmLabel: deferred ? 'Confirm queue order' : busy.length ? 'Confirm override' : 'Accept assignment',
      deferLabel: busy.length && !deferred ? 'Queue when feasible' : undefined,
    };
    context.notify(describe(pending) + ' · open Orders', 'Awaiting approval');
    return {
      ok: true, status: 'awaiting_pilot_confirmation', assignments, reason, current_task: currentTask,
      alternatives: busy.length && !deferred ? ['Confirm override', 'Queue when feasible', 'Dismiss'] : ['Confirm', 'Dismiss'],
    };
  }

  function describe(choice: Pending) {
    if (choice.kind === 'unit-recall') return 'Recall ' + choice.unit;
    if (choice.kind === 'assignment') return describeVoiceAssignments(choice.assignments);
    return choice.title;
  }

  function dismiss() {
    const choice = pending;
    clear();
    if (choice) context.notify(describe(choice), 'Cancelled');
  }

  function reject(error: string) {
    context.notify(error, 'Rejected');
    return unavailable(error);
  }

  function confirm(defer = false) {
    const choice = pending;
    clear();
    const sim = current();
    if (!choice) return;
    const summary = describe(choice);
    if (!sim || choice.stateToken !== stateToken(sim)) { reject(summary + ' expired. Ask again.'); return; }
    if (choice.kind === 'unit-recall') {
      const sameTask = sim.funnels.find(drone => drone.id === choice.unit)?.assignment === choice.unitRevision;
      if (sameTask && context.submitRecall(sim, choice.unit, choice.reason)) {
        context.notify(summary + ' · waiting for game', 'Approved');
      } else reject(summary + ' · drone task changed. Ask again.');
      return;
    }
    if (choice.kind !== 'assignment') {
      const changed = context.queue[choice.kind](choice.orderId);
      if (changed) context.notify(choice.orderId + (choice.kind === 'promote' ? ' promoted' : ''), choice.kind === 'promote' ? 'Waiting' : 'Cancelled');
      else reject(choice.orderId + ' is no longer waiting.');
      return;
    }
    if (defer || choice.deferred) {
      if (choice.assignments.some(a => !sim.turrets.some(t => t.id === a.target && t.health > 0))) { reject(summary + ' · target unavailable.'); return; }
      const queued = context.queue.add(sim.runId, choice.assignments, choice.reason);
      if (queued) context.notify(queued.id + ' · ' + summary, 'Waiting');
      else reject(summary + ' · queue unavailable or full.');
      return;
    }
    const feasible = choice.assignments.every((a, i) => sim.canRouteIntercept(a.unit, a.target) &&
      sim.funnels.find(drone => drone.id === a.unit)?.assignment === choice.unitRevisions[i]);
    if (feasible && context.submit(sim, choice.assignments, choice.reason)) {
      context.notify(summary + ' · waiting for game', 'Approved');
    } else reject(summary + ' · arena state changed. Ask for a new assignment.');
  }

  async function call(name: string, input: unknown) {
    const spec = voiceSupervisorSpecs.find(s => s.name === name);
    const args = input ?? {};
    if (!spec) return unavailable('Unknown voice tool.');
    const problem = validate(spec.input_schema, args);
    if (problem) return name === 'get_order_queue' ? unavailable(problem) : reject(problem);
    const sim = current();
    if (!sim) return unavailable('Resume a combat round first.');
    const values = args as Record<string, unknown>;
    if (name === 'get_order_queue') return { ok: true, orders: context.queue.rows() };
    if (values.state_token !== stateToken(sim)) return reject('State changed. Read the arena again.');
    clear();
    if (name === 'request_unit_recall') {
      const unit = values.unit as OrderAssignment['unit'];
      const drone = sim.funnels.find(f => f.id === unit);
      if (!drone) return reject('That drone is unavailable.');
      const currentTask = drone.order.type === 'INTERCEPT' ? `${unit} is assigned to ${drone.order.targetId}` : `${unit} is on escort duty`;
      const reason = `Return ${unit} to escort and cancel its waiting assignments.`;
      pending = {
        id: `voice-recall-${generation}`, kind: 'unit-recall', unit, unitRevision: drone.assignment,
        stateToken: stateToken(sim), title: `Recall ${unit}`, reason, currentTask, confirmLabel: `Confirm Recall ${unit}`,
      };
      context.notify(describe(pending) + ' · open Orders', 'Awaiting approval');
      return { ok: true, status: 'awaiting_pilot_confirmation', unit, reason, current_task: currentTask };
    }
    if (name === 'request_queue_change') {
      const order = context.queue.rows().find(row => row.id === values.id && row.status === 'waiting');
      if (!order) return reject('That order is no longer waiting.');
      const operation = values.operation as 'promote' | 'cancel';
      pending = {
        id: `queue-change-${generation}`, kind: operation, orderId: order.id, stateToken: stateToken(sim),
        title: `${operation === 'promote' ? 'Promote' : 'Cancel'} order ${order.id}`,
        reason: order.reason, assignments: order.assignments, confirmLabel: operation === 'promote' ? 'Confirm promotion' : 'Confirm cancellation',
      };
      context.notify(describe(pending) + ' · open Orders', 'Awaiting approval');
      return { ok: true, status: 'awaiting_pilot_confirmation', order_id: order.id, operation };
    }
    const deferred = values.timing === 'when_feasible';
    if (values.intent === 'defend') {
      const unit = values.unit as OrderAssignment['unit'] | undefined;
      if (!unit || !sim.funnels.some(drone => drone.id === unit)) return reject('Name an available drone to defend.');
      const target = nearestArmedTurret(sim);
      if (!target) return reject('No active armed turret to defend against.');
      if (!sim.canRouteIntercept(unit, target)) return reject(`${unit} has no route to the nearest armed turret, ${target}.`);
      return offer(sim, [{ unit, target }], `${target} is the nearest active armed turret.`, deferred);
    }
    if (values.intent === 'squad') {
      const { u1_target: first, u2_target: second } = values as { u1_target?: TargetId; u2_target?: TargetId };
      if (!first || !second || first === second) return reject('Name a different turret for each drone.');
      const assignments: OrderAssignment[] = [{unit: 'U1', target: first}, {unit: 'U2', target: second}];
      for (const {unit, target} of assignments) {
        if (!sim.funnels.some(drone => drone.id === unit) || !sim.turrets.some(t => t.id === target && t.health > 0))
          return reject(`${unit} or ${target} is unavailable.`);
        if (!deferred && !sim.canRouteIntercept(unit, target)) return reject(`${unit} has no route to ${target} now.`);
      }
      return offer(sim, assignments, 'Assign both drones together.', deferred);
    }
    if (values.intent === 'direct') {
      const { unit, target } = values as { unit?: OrderAssignment['unit']; target?: TargetId };
      if (!unit || !target) return reject('Name both the drone and turret.');
      if (!sim.funnels.some(drone => drone.id === unit)) return reject('That drone is unavailable.');
      if (!sim.turrets.some(t => t.id === target && t.health > 0)) return reject('That turret is unavailable.');
      if (!deferred && !sim.canRouteIntercept(unit, target)) {
        const alternative = units.find(candidate => candidate !== unit && idle(sim, candidate) && sim.canRouteIntercept(candidate, target));
        return {
          ...reject(`${unit} has no route to ${target} now.`),
          alternatives: alternative ? [`Use ${alternative} for ${target}`, 'Queue exact order', 'Dismiss'] : ['Queue exact order', 'Dismiss'],
        };
      }
      return offer(sim, [{ unit, target }], `Pilot requested ${unit} to intercept ${target}.`, deferred);
    }

    const turretDistance = (target: Simulation['turrets'][number]) => Math.hypot(target.position.x - sim.position.x, target.position.y - sim.position.y);
    const direction = values.intent === 'far' ? -1 : 1;
    const targets = sim.turrets.filter(t => t.health > 0 && !sim.funnels.some(drone => drone.order.type === 'INTERCEPT' && drone.order.targetId === t.id))
      .sort((a, b) => direction * (turretDistance(a) - turretDistance(b)) || a.id.localeCompare(b.id));
    const candidates = (unit: typeof units[number]) => targets.filter(t => sim.canRouteIntercept(unit, t.id));
    const available = units.filter(unit => idle(sim, unit));
    const distanceFromDrone = (unit: typeof units[number], target: Simulation['turrets'][number]) => {
      const drone = sim.funnels.find(f => f.id === unit)!;
      return Math.hypot(target.position.x - drone.position.x, target.position.y - drone.position.y);
    };
    const shortlist = available.map(unit => ({ unit, targets: candidates(unit) }));
    if (!shortlist.some(entry => entry.targets.length)) {
      const target = targets.find(t => units.some(unit => sim.canRouteIntercept(unit, t.id)));
      const replacement = target && units.filter(unit => sim.canRouteIntercept(unit, target.id))
        .sort((a, b) => distanceFromDrone(a, target) - distanceFromDrone(b, target))[0];
      return {
        ...reject(available.length ? 'No available drone can reach an unassigned live turret.' : 'Both drones have active orders.'),
        alternatives: target && replacement ? [`Propose replacing ${replacement}'s task with ${target.id}`, `Queue ${replacement} for ${target.id}`, 'Keep current orders'] : ['Keep current orders'],
      };
    }
    const generationAtRequest = generation;
    request = new AbortController();
    // Give each independently evaluated drone a preferred target to avoid conflicting assignments.
    const [first, second] = shortlist;
    const preferred = first.targets[0];
    if (preferred && second?.targets[0]?.id === preferred.id) {
      // When both want the same turret, give it to the closer drone if the other can take a different target.
      const alternate = (first.targets.length > 1 && (second.targets.length < 2 ||
        distanceFromDrone(second.unit, preferred) < distanceFromDrone(first.unit, preferred))) ? first : second;
      alternate.targets = alternate.targets.slice(1);
    }
    const inputForWorkers: WorkerRequest = {
      objective: values.intent === 'far' ? 'Intercept far live turrets. Prefer the first feasible candidate.' : 'Intercept near live turrets. Prefer the first feasible candidate.',
      workers: units.map(unit => ({
        unit, busy: !idle(sim, unit), candidates: (shortlist.find(entry => entry.unit === unit)?.targets ?? [])
          .map(t => ({ target: t.id, distance: distanceFromDrone(unit, t) })),
      })),
    };
    try {
      const result = await (context.workers ?? requestDroneWorkers)(inputForWorkers, request.signal);
      if (generationAtRequest !== generation || current() !== sim || values.state_token !== stateToken(sim)) return unavailable('The arena changed while the workers were checking. Ask again.');
      const assignments: OrderAssignment[] = [];
      const reasons: string[] = [];
      for (const worker of result.workers) {
        const target = worker.target;
        if (!target || !idle(sim, worker.unit) || !sim.canRouteIntercept(worker.unit, target) || assignments.some(a => a.target === target || a.unit === worker.unit)) continue;
        assignments.push({ unit: worker.unit, target });
        reasons.push(`${worker.unit}: ${worker.reason}`);
      }
      if (!assignments.length) return reject('The workers found no available assignment. Try an exact drone and turret or keep current orders.');
      return { ...offer(sim, assignments, reasons.join(' · ').slice(0, 160), deferred), provider: result.provider };
    } catch {
      const reason = 'Drone model workers unavailable. You can still specify a drone and turret.';
      return generationAtRequest === generation && current() === sim ? reject(reason) : unavailable(reason);
    } finally {
      if (generationAtRequest === generation) request = null;
    }
  }

  return {
    call, clear, confirm, dismiss, pending: () => pending,
    clientTools: () => Object.fromEntries(voiceSupervisorSpecs.map(spec => [spec.name, async (input: unknown) => JSON.stringify(await call(spec.name, input))])),
  };
}
