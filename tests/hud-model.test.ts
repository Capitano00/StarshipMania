import {describe, expect, it, vi} from 'vitest';
import {Simulation} from '../src/simulation';
import {neutralFrame} from '../src/contracts';
import {droneCards, eventSeverity, objectives, toHudEvent, toastWorthy} from '../src/hud/model';
import {HudFeed} from '../src/hud/feed';

describe('HUD model reflects real simulation state', () => {
  it('maps idle drones to escort cards with no invented telemetry', () => {
    const sim = new Simulation('hud-1');
    const cards = droneCards(sim);
    expect(cards.map(c => c.callsign)).toEqual(['U1', 'U2']);
    for (const c of cards) {
      expect(c.state).toBe('following');
      expect(c.task.label).toBe('ESCORT · PILOT');
      expect(c.authority).toBe('pilot');
      expect(c.health).toBeNull();
      expect(c.targetHull).toBeNull();
    }
  });

  it('shows a manual intercept, then Recall overriding it', () => {
    const sim = new Simulation('hud-2');
    sim.step(neutralFrame(), [sim.envelope({type: 'INTERCEPT', targetId: 'T1'}, 'local-hand-commit', 'cmd-1')]);
    for (let i = 0; i < 5; i++) sim.step(neutralFrame());
    let cards = droneCards(sim);
    expect(cards.every(c => c.task.targetId === 'T1' && ['moving', 'engaging', 'blocked'].includes(c.state))).toBe(true);
    expect(cards.every(c => c.targetHull === 1)).toBe(true);
    expect(objectives(sim, null).find(o => o.id === 'T1')?.state).toBe('assigned');
    expect(objectives(sim, 'T1').find(o => o.id === 'T1')?.state).toBe('locked');

    sim.step(neutralFrame(), [sim.envelope({type: 'RECALL'}, 'local-keyboard-recall', 'cmd-2')]);
    cards = droneCards(sim);
    expect(cards.every(c => c.task.kind !== 'intercept')).toBe(true);
    expect(cards.every(c => ['returning', 'following', 'blocked'].includes(c.state))).toBe(true);
    const recall = sim.events.entries.find(e => e.action === 'Recall')!;
    expect(eventSeverity(recall)).toBe('critical');
    expect(toastWorthy(recall)).toBe(true);
    expect(toHudEvent(recall).title).toBe('RECALL');
  });

  it('classifies event outcomes and keeps automatic assignment out of toasts', () => {
    expect(eventSeverity({action: 'Command', outcome: 'Rejected'})).toBe('warn');
    expect(eventSeverity({action: 'Deploy / redirect', outcome: 'Accepted'})).toBe('success');
    expect(eventSeverity({action: 'Auto assignment', outcome: 'Changed'})).toBe('info');
    expect(toastWorthy({id: 1, tick: 1, action: 'Auto assignment', outcome: 'Changed', detail: '', target: 'T1'})).toBe(false);
  });

  it('merges optional telemetry without changing simulation-derived task state', () => {
    const sim = new Simulation('hud-3');
    const [u1] = droneCards(sim, {U1: {health: .8, reason: 'Covering the pilot', authority: 'agent'}});
    expect(u1).toMatchObject({health: .8, reason: 'Covering the pilot', authority: 'agent', state: 'following'});
  });
});

describe('HUD feed defaults are honest and decisions need a gameplay handler', () => {
  it('starts offline with no suggestion and cannot decide without handlers', () => {
    const feed = new HudFeed();
    expect(feed.voice.status).toBe('unavailable');
    expect(feed.agentLink).toBe('offline');
    expect(feed.suggestion).toBeNull();
    feed.setSuggestion({id: 's1', droneId: 'U1', action: 'Regroup', reason: 'test', status: 'pending'});
    expect(feed.canDecide).toBe(false);
    expect(feed.decide('accept')).toBe(false);
  });

  it('routes Accept/Dismiss to registered handlers only while pending', () => {
    const feed = new HudFeed(), accept = vi.fn(), dismiss = vi.fn();
    const off = feed.onDecision({accept, dismiss});
    feed.setSuggestion({id: 's2', droneId: 'U2', action: 'Hold', reason: 'test', status: 'pending'});
    expect(feed.decide('dismiss')).toBe(true);
    expect(dismiss).toHaveBeenCalledWith('s2');
    feed.setSuggestion({...feed.suggestion!, status: 'recalled'});
    expect(feed.decide('accept')).toBe(false);
    expect(accept).not.toHaveBeenCalled();
    off();
    expect(feed.canDecide).toBe(false);
  });
});
