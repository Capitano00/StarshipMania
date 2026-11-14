import {describe, expect, it} from 'vitest';
import {Simulation} from '../src/simulation';
import {neutralFrame} from '../src/contracts';
import {AgentController} from '../src/agent/controller';
import {connectHud} from '../src/agent/hud-bridge';
import {HudFeed} from '../src/hud/feed';
import {createVoiceHudBridge} from '../src/hud/voice-bridge';
import {droneCards, toastWorthy} from '../src/hud/model';
import type {HudInputEvent} from '../src/hud/contract';

describe('supervisor → real hudFeed', () => {
  it('shows real proposals, routes Accept to the controller, and highlights proposed then executing targets', () => {
    const sim = new Simulation('h1'), ctrl = new AgentController(), feed = new HudFeed();
    const bridge = connectHud(ctrl, feed);
    expect(feed.agentLink).toBe('live');
    const r = ctrl.submit(sim, {kind: 'intercept', unit: 'U1', target: 'T1', reason: 'T1 is armed and nearest'}, AgentController.basis(sim));
    if (!r.ok) throw new Error(r.error);
    bridge.update(sim);
    expect(feed.suggestion).toMatchObject({id: r.proposalId, droneId: 'U1', action: 'U1 intercept T1', reason: 'T1 is armed and nearest', status: 'pending'});
    expect(feed.agents.U1).toMatchObject({phase: 'proposing', targetId: 'T1'});
    expect(feed.targetMarks()).toMatchObject([{targetId: 'T1', phase: 'proposing', droneId: 'U1'}]);
    expect(feed.canDecide).toBe(true);
    expect(feed.decide('accept')).toBe(true);                    // the HUD's Accept button path
    const sent = ctrl.drain(sim);
    expect(sent).toHaveLength(1);
    sim.step(neutralFrame(), sent); ctrl.observe(sim); bridge.update(sim);
    expect(sim.funnels[0].order).toEqual({type: 'INTERCEPT', targetId: 'T1'});
    expect(feed.suggestion).toBeNull();
    expect(feed.agents.U1.phase).toBe('executing');
    expect(feed.targetMarks()).toMatchObject([{targetId: 'T1', phase: 'executing'}]);
  });

  it('Dismiss reaches the controller and nothing is sent', () => {
    const sim = new Simulation('h2'), ctrl = new AgentController(), feed = new HudFeed();
    const bridge = connectHud(ctrl, feed);
    const r = ctrl.submit(sim, {kind: 'recall', unit: 'U2'}, AgentController.basis(sim));
    if (!r.ok) throw new Error(r.error);
    bridge.update(sim);
    feed.decide('dismiss');
    expect(ctrl.drain(sim)).toEqual([]);
    expect(ctrl.task(r.taskIds[0])?.status).toBe('dismissed');
  });
});

describe('ElevenLabs voice → HUD voice panel (genuine events only)', () => {
  it('maps session states and transcript/response events without inventing any', () => {
    const published: HudInputEvent[] = [];
    const v = createVoiceHudBridge({publish: e => published.push(e)});
    v.status('connecting'); v.status('listening');
    v.event({type: 'draft', speaker: 'You', id: '1:7', text: 'Recall'});
    v.event({type: 'final', speaker: 'You', id: '1:7', text: 'Recall drones'});
    v.event({type: 'awaiting-tool'});
    v.event({type: 'result', text: 'Recall accepted'});
    v.event({type: 'interrupted'});
    v.event({type: 'append', speaker: 'Agent', id: '1:8', text: 'Recalling '});
    v.event({type: 'append', speaker: 'Agent', id: '1:8', text: 'now.'});
    v.status('speaking'); v.status('unavailable', 'Microphone permission denied'); v.status('off');
    expect(published).toEqual([
      {type: 'voice.status', status: 'processing', message: 'Connecting to voice'},
      {type: 'voice.status', status: 'listening'},
      {type: 'voice.transcript', text: 'Recall', final: false},
      {type: 'voice.transcript', text: 'Recall drones', final: true},
      {type: 'voice.status', status: 'processing'},
      {type: 'voice.response', text: 'Recalling '},
      {type: 'voice.response', text: 'Recalling now.'},
      {type: 'voice.status', status: 'responding'},
      {type: 'voice.status', status: 'error', message: 'Microphone permission denied'},
      {type: 'voice.status', status: 'unavailable'},
    ]);
  });
});

describe('HUD model reflects the expanded simulation', () => {
  it('marks autonomously assigned drones as agent-controlled and toasts unit/squad/autonomy events', () => {
    const sim = new Simulation('h3');
    sim.step(neutralFrame(), [], false, [sim.intent({type: 'AUTONOMY', enabled: true, fire: true}, 'local-button')]);
    sim.step(neutralFrame(), [sim.envelope({type: 'INTERCEPT', targetId: 'T1'}, 'local-autonomous', 'cmd-900000001', 'U1')]);
    expect(droneCards(sim).map(c => c.authority)).toEqual(['agent', 'pilot']);
    expect(sim.events.entries.filter(toastWorthy).map(e => e.action)).toEqual(expect.arrayContaining(['Unit deploy', 'Autonomy']));
  });
});
