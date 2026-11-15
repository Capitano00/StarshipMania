import {describe, expect, it, vi} from 'vitest';
import {OrderQueue, type OrderAssignment} from '../src/agent/order-queue';
import type {requestDroneWorkers, WorkerResponse} from '../src/agent/drone-worker-contract';
import {createVoiceSupervisor} from '../src/agent/voice-supervisor';
import {Simulation} from '../src/simulation';

const stateToken = (sim: Simulation) => `${sim.runId}@${sim.controlEpoch}`;

function setup(workers?: typeof requestDroneWorkers) {
  const sim = new Simulation('voice-supervisor-test');
  const queue = new OrderQueue();
  queue.reset(sim.runId);
  let commandId = 10;
  const submit = vi.fn((simulation: Simulation, assignments: OrderAssignment[]) => simulation.accept({
    ...simulation.envelope({type: 'RECALL'}, 'local-approved-proposal', `cmd-${commandId++}`),
    payload: {type: 'SQUAD', assignments: assignments.map(({unit, target}) => ({unit, targetId: target}))},
  }));
  const notify = vi.fn();
  const submitRecall = vi.fn((simulation: Simulation, unit: OrderAssignment['unit']) =>
    simulation.accept(simulation.envelope({type: 'RECALL'}, 'local-approved-proposal', `cmd-${commandId++}`, unit)));
  const supervisor = createVoiceSupervisor({current: () => sim, queue, submit, submitRecall, notify, workers});
  const direct = (unit: OrderAssignment['unit'], target: OrderAssignment['target'], timing: 'now' | 'when_feasible' = 'now') =>
    supervisor.call('plan_drone_assignment', {intent: 'direct', timing, unit, target, state_token: stateToken(sim)});
  const guided = () => supervisor.call('plan_drone_assignment', {intent: 'far', timing: 'now', state_token: stateToken(sim)});
  const change = (operation: 'promote' | 'cancel', id: string) =>
    supervisor.call('request_queue_change', {id, operation, state_token: stateToken(sim)});
  return {sim, queue, submit, submitRecall, notify, supervisor, direct, guided, change};
}

describe('voice supervisor pilot approval', () => {
  it('proposes the exact drone and target without using the model or moving a drone until confirmed', async () => {
    const workers = vi.fn<typeof requestDroneWorkers>();
    const {sim, submit, direct, supervisor} = setup(workers);
    expect(await direct('U2', 'T3')).toMatchObject({ok: true, status: 'awaiting_pilot_confirmation', assignments: [{unit: 'U2', target: 'T3'}]});
    expect(workers).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(sim.funnels.map(drone => drone.order.type)).toEqual(['RECALL', 'RECALL']);

    supervisor.confirm();
    expect(sim.funnels.map(drone => drone.order)).toEqual([{type: 'RECALL'}, {type: 'INTERCEPT', targetId: 'T3'}]);
    expect(supervisor.pending()).toBeNull();
    supervisor.confirm();
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('asks the idle worker for a guided assignment while keeping the busy drone and its target out of the proposal', async () => {
    const workers = vi.fn<typeof requestDroneWorkers>(async request => ({
      provider: 'ollama',
      workers: request.workers.map(({unit, candidates}) => ({unit, target: candidates[0]?.target ?? null, reason: 'Prefer the first feasible target'})),
    }));
    const {sim, submit, guided, supervisor} = setup(workers);
    expect(sim.accept(sim.envelope({type: 'INTERCEPT', targetId: 'T1'}, 'local-approved-proposal', 'cmd-1', 'U1'))).toBe(true);

    const result = await guided();
    const request = workers.mock.calls[0][0];
    expect(request.workers[0]).toEqual({unit: 'U1', busy: true, candidates: []});
    expect(request.workers[1]).toMatchObject({unit: 'U2', busy: false});
    const [first, ...otherCandidates] = request.workers[1].candidates;
    expect(first).toBeDefined();
    expect([first, ...otherCandidates].every(({target}) => target !== 'T1')).toBe(true);
    expect(result).toMatchObject({ok: true, provider: 'ollama', assignments: [{unit: 'U2', target: first.target}]});
    expect(submit).not.toHaveBeenCalled();

    supervisor.confirm();
    expect(sim.funnels.map(drone => drone.order)).toEqual([
      {type: 'INTERCEPT', targetId: 'T1'}, {type: 'INTERCEPT', targetId: first.target},
    ]);
  });

  it('adds, promotes and cancels deferred orders only after separate confirmations', async () => {
    const {queue, submit, direct, change, supervisor} = setup();
    expect(await direct('U1', 'T1', 'when_feasible')).toMatchObject({ok: true, status: 'awaiting_pilot_confirmation'});
    expect(queue.rows()).toEqual([]);
    supervisor.confirm();
    await direct('U2', 'T3', 'when_feasible');
    supervisor.confirm();
    const [first, second] = queue.rows();
    expect(first?.status).toBe('waiting');
    expect(second?.status).toBe('waiting');
    expect(submit).not.toHaveBeenCalled();

    expect(await change('promote', second.id)).toMatchObject({ok: true, order_id: second.id});
    expect(queue.rows().map(row => row.id)).toEqual([first.id, second.id]);
    supervisor.confirm();
    expect(queue.rows().map(row => row.id)).toEqual([second.id, first.id]);

    expect(await change('cancel', second.id)).toMatchObject({ok: true, order_id: second.id});
    expect(queue.rows()[0].status).toBe('waiting');
    supervisor.confirm();
    expect(await supervisor.call('get_order_queue', {})).toMatchObject({ok: true, orders: [
      {id: second.id, status: 'cancelled'}, {id: first.id, status: 'waiting'},
    ]});
    expect(submit).not.toHaveBeenCalled();
  });

  it.each(['clear', 'Recall'] as const)('discards a worker answer received after %s', async invalidation => {
    let finish!: (response: WorkerResponse) => void;
    const workers = vi.fn<typeof requestDroneWorkers>(() => new Promise(resolve => { finish = resolve; }));
    const {sim, submit, guided, supervisor} = setup(workers);
    const result = guided();
    const [request, signal] = workers.mock.calls[0];
    if (invalidation === 'clear') {
      supervisor.clear();
      expect(signal?.aborted).toBe(true);
    } else {
      expect(sim.accept(sim.envelope({type: 'RECALL'}, 'local-voice-recall', 'cmd-1'))).toBe(true);
    }
    finish({provider: 'openai', workers: request.workers.map(({unit, candidates}) => ({
      unit, target: candidates[0]?.target ?? null, reason: 'Feasible',
    }))});

    expect(await result).toMatchObject({ok: false});
    expect(supervisor.pending()).toBeNull();
    supervisor.confirm();
    expect(submit).not.toHaveBeenCalled();
    expect(sim.funnels.map(drone => drone.order.type)).toEqual(['RECALL', 'RECALL']);
  });

  it('proposes the nearest armed target in defend mode and shows the existing assignment', async () => {
    const {sim, supervisor} = setup();
    expect(sim.accept(sim.envelope({type: 'INTERCEPT', targetId: 'T3'}, 'local-approved-proposal', 'cmd-1', 'U2'))).toBe(true);
    const result = await supervisor.call('plan_drone_assignment', {intent: 'defend', timing: 'now', state_token: stateToken(sim), unit: 'U2'});
    expect(result).toMatchObject({ok: true, current_task: 'U2 is assigned to T3', assignments: [{unit: 'U2', target: 'T1'}]});
    supervisor.confirm();
    expect(sim.funnels[1].order).toEqual({type: 'INTERCEPT', targetId: 'T1'});
  });

  it('rejects the entire squad proposal if a target is no longer alive at confirmation', async () => {
    const {sim, supervisor, submit} = setup();
    const input = {intent: 'squad', timing: 'now', state_token: stateToken(sim), u1_target: 'T1', u2_target: 'T3'};
    expect(await supervisor.call('plan_drone_assignment', {...input, u2_target: 'T1'})).toMatchObject({ok: false});
    expect(await supervisor.call('plan_drone_assignment', input)).toMatchObject({ok: true, assignments: [{unit: 'U1', target: 'T1'}, {unit: 'U2', target: 'T3'}]});
    sim.turrets.find(turret => turret.id === 'T3')!.health = 0;
    supervisor.confirm();
    expect(submit).not.toHaveBeenCalled();
    expect(sim.funnels.map(drone => drone.order.type)).toEqual(['RECALL', 'RECALL']);
  });

  it('changes only the named drone after an approved single-unit Recall', async () => {
    const {sim, supervisor, submitRecall} = setup();
    const input = {intent: 'squad', timing: 'now', state_token: stateToken(sim), u1_target: 'T1', u2_target: 'T3'};
    expect(await supervisor.call('plan_drone_assignment', input)).toMatchObject({ok: true});
    supervisor.confirm();
    expect(sim.funnels.map(drone => drone.order)).toEqual([{type: 'INTERCEPT', targetId: 'T1'}, {type: 'INTERCEPT', targetId: 'T3'}]);

    const recall = {unit: 'U1', state_token: stateToken(sim)};
    expect(await supervisor.call('request_unit_recall', recall)).toMatchObject({ok: true, unit: 'U1', current_task: 'U1 is assigned to T1'});
    expect(submitRecall).not.toHaveBeenCalled();
    supervisor.confirm();
    expect(sim.funnels.map(drone => drone.order)).toEqual([{type: 'RECALL'}, {type: 'INTERCEPT', targetId: 'T3'}]);
  });
});
