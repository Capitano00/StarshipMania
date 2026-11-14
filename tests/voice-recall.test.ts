import { describe, expect, it } from 'vitest';
import { RecallTurn } from '../src/voice-recall';
import { Simulation } from '../src/simulation';
import { localGameConfig } from '../vite.config';
import { readFileSync } from 'node:fs';

describe('ElevenLabs Recall authority', () => {
  it('consumes one direct utterance and refuses repeated provider IDs', () => {
    const turn = new RecallTurn();
    turn.hear('Recall drones.', 1, 100);
    expect(turn.consume('call-1', 1, 200)).toBe(true);
    expect(turn.consume('second-call-on-turn', 1, 201)).toBe(false);
    turn.hear('Recall the drones', 2, 300);
    expect(turn.consume('call-1', 2, 400)).toBe(false);
    expect(turn.consume('old-turn', 1, 401)).toBe(false);
    expect(turn.consume('call-2', 2, 402)).toBe(true);
  });

  it('rejects negation, stale speech, and speech invalidated by manual Recall', () => {
    const turn = new RecallTurn();
    turn.hear('Recall drones', 1, 100);
    turn.hear('Do not recall drones.', 2, 200);
    expect(turn.hear('Recall drones', 1, 300)).toBe(false);
    expect(turn.consume('negated', 2, 350)).toBe(false);
    turn.hear('Recall drones', 3, 400);
    expect(turn.consume('late', 3, 9_000)).toBe(false);
    turn.hear('Recall drones', 4, 9_100);
    turn.invalidate();
    expect(turn.consume('manual-won', 4, 9_200)).toBe(false);
  });

  it('accepts voice for Recall only and records its source', () => {
    const sim = new Simulation();
    sim.fireAtWill = true;
    sim.commands([sim.envelope({ type: 'RECALL' }, 'local-voice-recall', 'cmd-1')]);
    expect(sim.accepted).toBe(1);
    expect(sim.fireAtWill).toBe(false);
    expect(sim.events.entries[0]?.detail).toContain('Voice');
    sim.commands([sim.envelope({ type: 'INTERCEPT', targetId: 'T1' }, 'local-voice-recall', 'cmd-2')]);
    expect(sim.accepted).toBe(1);
  });

  it('only grants microphone and ElevenLabs connection access for configured local voice', () => {
    const disabled = localGameConfig({});
    const enabled = localGameConfig({ ELEVENLABS_API_KEY: 'test', ELEVENLABS_AGENT_ID: 'agent_test' });
    expect(disabled.server.headers['Permissions-Policy']).toContain('microphone=()');
    expect(enabled.preview.headers['Permissions-Policy']).toContain('microphone=(self)');
    expect(enabled.server.headers['Content-Security-Policy']).toContain('wss://api.elevenlabs.io');
    expect(disabled.preview.headers['Content-Security-Policy']).not.toContain('wss://api.elevenlabs.io');
    const document = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    expect(document).toMatch(/connect-src [^;]+wss:\/\/api\.elevenlabs\.io;/);
    expect(enabled.server.headers['Content-Security-Policy']).toContain("script-src 'self' 'wasm-unsafe-eval';");
  });
});
