import {describe, expect, it} from 'vitest';
import {Simulation} from '../src/simulation';
import {neutralFrame} from '../src/contracts';
import {AgentController} from '../src/agent/controller';
import {createSupervisorTools, toClientToolHandlers} from '../src/agent/tools';
import {voiceClientTools} from '../src/voice-recall';

const voiceRecall = (sim: Simulation, id: string) => sim.envelope({type: 'RECALL'}, 'local-voice-recall', id);
const autonomyOn = (sim: Simulation) => sim.step(neutralFrame(), [], false, [sim.intent({type: 'AUTONOMY', enabled: true, fire: true}, 'local-button')]);

describe('spoken Recall (ElevenLabs recall_drones) is pilot authority for the supervisor', () => {
  it('switches autonomy off, recalls agent tasks and makes older decisions stale', () => {
    const sim = new Simulation('v1'), ctrl = new AgentController();
    autonomyOn(sim);
    const basis = AgentController.basis(sim);
    const r = ctrl.submit(sim, {kind: 'intercept', unit: 'U1', target: 'T1'}, basis);
    if (!r.ok) throw new Error(r.error);
    sim.step(neutralFrame(), ctrl.drain(sim)); ctrl.observe(sim);
    expect(sim.funnels[0].order).toEqual({type: 'INTERCEPT', targetId: 'T1'});
    sim.commands([voiceRecall(sim, 'cmd-1')]); ctrl.observe(sim);
    expect(sim.autonomy.enabled).toBe(false);
    expect(sim.funnels.every(f => f.order.type === 'RECALL')).toBe(true);
    expect(ctrl.task(r.taskIds[0])).toMatchObject({status: 'recalled', detail: 'Emergency Recall (all units)'});
    expect(sim.events.entries.find(e => e.action === 'Recall')?.detail).toContain('Voice');
    expect(ctrl.submit(sim, {kind: 'intercept', unit: 'U2', target: 'T2'}, basis)).toMatchObject({ok: false, code: 'stale'});
  });

  it('outranks a same-tick autonomous order, and voice can still only Recall', () => {
    const sim = new Simulation('v2');
    autonomyOn(sim);
    const agent = {...sim.envelope({type: 'INTERCEPT', targetId: 'T3'}, 'local-autonomous', 'cmd-900000001', 'U1')};
    sim.step(neutralFrame(), [agent, voiceRecall(sim, 'cmd-2')]);
    expect(sim.funnels.every(f => f.order.type === 'RECALL')).toBe(true);
    expect(sim.accept(sim.envelope({type: 'INTERCEPT', targetId: 'T1'}, 'local-voice-recall', 'cmd-3'))).toBe(false);
    expect(sim.accept({...sim.envelope({type: 'RECALL'}, 'local-voice-recall', 'cmd-4'), payload: {type: 'SQUAD', assignments: [{unit: 'U1', targetId: 'T1'}]}})).toBe(false);
  });
});

describe('voice session client tools', () => {
  it('exposes the seven supervisor tools beside recall_drones, which cannot be replaced', () => {
    const sim = new Simulation('v3'), controller = new AgentController();
    const handlers = toClientToolHandlers(createSupervisorTools({getSim: () => sim, controller}));
    const recall = () => 'recall handler';
    const tools = voiceClientTools(recall, {...handlers, recall_drones: () => 'hijacked'});
    expect(tools.recall_drones).toBe(recall);
    expect(Object.keys(tools).sort()).toEqual(['assign_squad', 'assign_target', 'defend_pilot', 'get_game_state', 'get_recent_events', 'get_task_status', 'recall_drones', 'recall_unit']);
    const state = JSON.parse(tools.get_game_state({}));
    expect(state).toMatchObject({ok: true, state_token: 'v3@0'});
    const proposal = JSON.parse(tools.assign_target({unit: 'U2', target: 'T3', reason: 'Spoken request from the pilot', state_token: state.state_token}));
    expect(proposal).toMatchObject({ok: true, mode: 'awaiting_approval'});
    expect(controller.pending()).toHaveLength(1);
    expect(sim.funnels[1].order.type).toBe('RECALL'); // nothing moves until the pilot approves
  });

  it('supervisor tools stop answering when the voice session is no longer active', () => {
    let active = true;
    const tools = voiceClientTools(() => 'r', {get_game_state: () => '{"ok":true}'}, () => active);
    expect(tools.get_game_state({})).toBe('{"ok":true}');
    active = false;
    expect(JSON.parse(tools.get_game_state({}))).toMatchObject({ok: false, code: 'unavailable'});
  });

  it('without supervisor tools the session exposes only recall_drones (original behaviour)', () => {
    expect(Object.keys(voiceClientTools(() => 'r'))).toEqual(['recall_drones']);
  });
});
