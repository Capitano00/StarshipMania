import * as THREE from 'three';
import {describe, expect, it, vi} from 'vitest';
import {HudFeed} from '../src/hud/feed';
import {demoRequested} from '../src/hud/demo';
import {ArenaFx} from '../src/fx/arena-fx';
import {Simulation} from '../src/simulation';

const feedAt = () => { let t = 0; return {feed: new HudFeed(() => ++t), tick: () => t}; };

describe('voice event transitions', () => {
  it('runs listening → partial → final → processing → responding, without a provider', () => {
    const {feed} = feedAt();
    expect(feed.voice.status).toBe('unavailable');
    feed.publish({type: 'voice.status', status: 'listening'});
    expect(feed.voice).toEqual({status: 'listening'});
    feed.publish({type: 'voice.transcript', text: 'U1, ta', final: false});
    expect(feed.voice).toMatchObject({status: 'transcribing', partial: 'U1, ta', final: undefined});
    feed.publish({type: 'voice.transcript', text: 'U1, take T4', final: true});
    expect(feed.voice).toMatchObject({status: 'transcribing', final: 'U1, take T4', partial: undefined});
    feed.publish({type: 'voice.status', status: 'processing'});
    expect(feed.voice).toMatchObject({status: 'processing', final: 'U1, take T4'});
    feed.publish({type: 'voice.response', text: 'Copy. U1 engaging T4.'});
    expect(feed.voice).toMatchObject({status: 'responding', final: 'U1, take T4', reply: 'Copy. U1 engaging T4.'});
  });

  it('clears the previous exchange when listening restarts, and reports errors', () => {
    const {feed} = feedAt();
    feed.publish({type: 'voice.response', text: 'old reply'});
    feed.publish({type: 'voice.status', status: 'listening'});
    expect(feed.voice.reply).toBeUndefined();
    feed.publish({type: 'voice.status', status: 'error', message: 'Mic denied'});
    expect(feed.voice).toMatchObject({status: 'error', message: 'Mic denied'});
    feed.publish({type: 'voice.status', status: 'unavailable'});
    expect(feed.voice).toEqual({status: 'unavailable'});
  });
});

describe('agent phases and Recall precedence', () => {
  it('tracks per-drone phases with agent-provided reasons only', () => {
    const {feed} = feedAt();
    feed.publish({type: 'agent.phase', droneId: 'U1', phase: 'planning'});
    expect(feed.agents.U1).toMatchObject({phase: 'planning', reason: undefined});
    feed.publish({type: 'agent.phase', droneId: 'U1', phase: 'proposing', action: 'Intercept T4', reason: 'Nearest armed', targetId: 'T4'});
    expect(feed.targetMarks()).toEqual([{targetId: 'T4', phase: 'proposing', droneId: 'U1', since: feed.agents.U1.at}]);
    feed.publish({type: 'agent.phase', droneId: 'U1', phase: 'completed', action: 'Done'});
    expect(feed.targetMarks()).toEqual([]);
    feed.publish({type: 'agent.clear', droneId: 'U1'});
    expect(feed.agents.U1).toBeUndefined();
  });

  it('Recall overrides active work and closes pending or accepted suggestions; finished work is untouched', () => {
    const {feed} = feedAt();
    const accept = vi.fn();
    feed.onDecision({accept, dismiss: vi.fn()});
    feed.publish({type: 'agent.phase', droneId: 'U1', phase: 'executing', action: 'Intercept T2', targetId: 'T2'});
    feed.publish({type: 'agent.phase', droneId: 'U2', phase: 'failed', action: 'Intercept T6', reason: 'No lane'});
    feed.publish({type: 'agent.suggestion', suggestion: {id: 's1', droneId: 'U1', action: 'Intercept T2', reason: 'r', status: 'pending'}});
    expect(feed.noteRecall()).toBe(true);
    expect(feed.agents.U1.phase).toBe('recalled');
    expect(feed.agents.U2.phase).toBe('failed');
    expect(feed.suggestion?.status).toBe('recalled');
    expect(feed.canDecide).toBe(false);
    expect(feed.decide('accept')).toBe(false);
    expect(accept).not.toHaveBeenCalled();
    expect(feed.targetMarks()).toEqual([]);
    expect(feed.noteRecall()).toBe(false);
  });
});

describe('3D agent target highlight', () => {
  it('shows a beacon for proposed/executing targets and bursts once when an action is accepted', () => {
    const fx = new ArenaFx(new THREE.Scene());
    const sim = new Simulation('fx-agent');
    const target = sim.turrets[0].id;
    fx.update(sim, null, null, [{targetId: target, phase: 'proposing', droneId: 'U1', since: 1}]);
    expect(fx.stats().bursts).toBe(0);
    fx.update(sim, null, null, [{targetId: target, phase: 'executing', droneId: 'U1', since: 2}]);
    const after = fx.stats().bursts;
    expect(after).toBe(1);
    fx.update(sim, null, null, [{targetId: target, phase: 'executing', droneId: 'U1', since: 2}]);
    expect(fx.stats().bursts).toBe(after);
  });
});

describe('developer demo gating', () => {
  it('is off unless ?hud-demo is present', () => {
    expect(demoRequested('')).toBe(false);
    expect(demoRequested('?qa')).toBe(false);
    expect(demoRequested('?qa&hud-demo')).toBe(true);
  });
});
