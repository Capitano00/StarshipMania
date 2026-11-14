import {describe, expect, it} from 'vitest';
import {Simulation} from '../src/simulation';
import {neutralFrame} from '../src/contracts';

/** Pins the pre-existing group pipeline that gestures, keyboard, training and the HUD rely on. */
describe('existing group commands are unchanged by per-unit support', () => {
  it('envelope() still defaults to the group, with the original fields', () => {
    const s = new Simulation();
    const e = s.envelope({type: 'INTERCEPT', targetId: 'T1'}, 'local-hand-commit', 'cmd-1');
    expect(Object.keys(e).sort()).toEqual(['commandId', 'expiresAtTick', 'group', 'issuedAtTick', 'payload', 'provenance', 'runId', 'schemaId', 'version']);
    expect(e).toMatchObject({group: 'funnels', schemaId: 'CommandEnvelope.v1', version: 1, expiresAtTick: e.issuedAtTick + 12});
  });

  it('hand deploy and keyboard/hand Recall keep their messages, events and counters', () => {
    const s = new Simulation();
    s.step(neutralFrame(), [s.envelope({type: 'INTERCEPT', targetId: 'T1'}, 'local-hand-commit', 'cmd-1')]);
    expect(s.message).toBe('Assignment accepted: T1');
    expect(s.events.entries[0]).toMatchObject({action: 'Deploy / redirect', outcome: 'Accepted', target: 'T1'});
    for (const provenance of ['local-keyboard-recall', 'local-hand-recall'] as const) {
      s.step(neutralFrame(), [s.envelope({type: 'RECALL'}, provenance, `cmd-${provenance.length}`)]);
      expect(s.message).toBe('Recall accepted - returning to follow positions');
      expect(s.events.entries[0]).toMatchObject({action: 'Recall', outcome: 'Accepted'});
    }
    expect([s.deployments, s.recalls, s.unitRecalls]).toEqual([1, 2, 0]);
  });

  it('gestures cannot reach the new authority: hand-commit Recall and keyboard intercept stay invalid', () => {
    const s = new Simulation();
    expect(s.accept(s.envelope({type: 'RECALL'}, 'local-hand-commit', 'cmd-1'))).toBe(false);
    expect(s.accept(s.envelope({type: 'INTERCEPT', targetId: 'T1'}, 'local-keyboard-recall', 'cmd-2'))).toBe(false);
  });

  it('guided practice still progresses through group deploy, redirect and Recall', () => {
    const s = new Simulation('practice', 'training');
    s.step(neutralFrame(), [s.envelope({type: 'INTERCEPT', targetId: 'T1'}, 'local-hand-commit', 'cmd-1')]);
    expect(s.trainingStep).toBe(1);
    s.trainingStep = 2; // hit confirmation is covered by training.test.ts
    s.step(neutralFrame(), [s.envelope({type: 'INTERCEPT', targetId: 'T2'}, 'local-hand-commit', 'cmd-2')]);
    expect(s.trainingStep).toBe(3);
    s.step(neutralFrame(), [s.envelope({type: 'RECALL'}, 'local-keyboard-recall', 'cmd-3')]);
    expect(s.trainingStep).toBe(4);
  });
});
