/**
 * DEVELOPER-ONLY demo of voice/agent HUD states (`?hud-demo`).
 *
 * Publishes SIMULATED events to hudFeed so the UI can be inspected without ElevenLabs or
 * the drone agents. It never touches the Simulation, controls or commands: drones keep
 * following real gameplay, and a real Recall (V) still overrides the demo. A permanent
 * banner states that the events are simulated. Not started in normal play.
 */
import type {HudFeed} from './feed';
import type {HudInputEvent} from './contract';

type Step = {at: number; events?: HudInputEvent[]; run?: () => void; caption: string};

export function demoRequested(search = location.search) { return new URLSearchParams(search).has('hud-demo'); }

export function startHudDemo(feed: HudFeed, host: HTMLElement) {
  const banner = document.createElement('div');
  banner.className = 'hud-demo-banner';
  banner.setAttribute('role', 'note');
  const caption = document.createElement('span');
  banner.append(Object.assign(document.createElement('b'), {textContent: 'DEV DEMO · SIMULATED VOICE + AGENT EVENTS'}), caption);
  // Pinned to the window (not the arena) so it is visible from page load: an obvious
  // signal that demo mode is active, on the setup screen as well as in play.
  document.body.append(banner);

  let timers: number[] = [], decided = false, stopped = false;
  const at = (ms: number, fn: () => void) => { timers.push(window.setTimeout(() => { if (!stopped) fn(); }, ms)); };
  const pub = (...events: HudInputEvent[]) => events.forEach(e => feed.publish(e));
  const off = feed.onDecision({
    accept: id => { decided = true; feed.publish({type: 'agent.suggestion', suggestion: {...feed.suggestion!, id, status: 'accepted'}}); executeU1(); },
    dismiss: id => { decided = true; feed.publish({type: 'agent.suggestion', suggestion: {...feed.suggestion!, id, status: 'dismissed'}}); pub({type: 'agent.phase', droneId: 'U1', phase: 'idle'}, {type: 'voice.response', text: 'Understood. U1 holding escort.'}); },
  });
  const reason = 'T4 is armed and closest to U1’s route';

  function executeU1() {
    caption.textContent = 'Executing · accepted actions highlight the target (lavender beacon + burst)';
    pub({type: 'agent.phase', droneId: 'U1', phase: 'executing', action: 'Intercept T4', reason, targetId: 'T4'},
      {type: 'voice.response', text: 'Copy. U1 engaging T4.'});
  }

  const steps: Step[] = [
    {at: 0, caption: 'Agent link established', events: [{type: 'agent.link', state: 'live'}, {type: 'voice.status', status: 'idle'}, {type: 'agent.clear'}, {type: 'agent.suggestion', suggestion: null}]},
    {at: 900, caption: 'Listening · green mic indicator', events: [{type: 'voice.status', status: 'listening'}]},
    {at: 2000, caption: 'Live transcription (partial)', events: [{type: 'voice.transcript', text: 'U1, take', final: false}]},
    {at: 2700, caption: 'Live transcription (partial)', events: [{type: 'voice.transcript', text: 'U1, take the armed one', final: false}]},
    {at: 3500, caption: 'Final transcript', events: [{type: 'voice.transcript', text: 'U1, take the armed one on the left', final: true}]},
    {at: 4300, caption: 'Processing · agents planning', events: [{type: 'voice.status', status: 'processing'}, {type: 'agent.phase', droneId: 'U1', phase: 'planning', action: 'Evaluating targets'}, {type: 'agent.phase', droneId: 'U2', phase: 'planning', action: 'Covering pilot'}]},
    {at: 6200, caption: 'Proposing · awaiting pilot decision (Accept / Dismiss)', events: [
      {type: 'agent.phase', droneId: 'U1', phase: 'proposing', action: 'Intercept T4', reason, targetId: 'T4'},
      {type: 'agent.suggestion', suggestion: {id: 'demo-1', droneId: 'U1', action: 'Intercept T4', reason, status: 'pending'}},
      {type: 'voice.response', text: 'U1 proposes intercepting T4. Accept or dismiss?'}]},
    {at: 11500, caption: 'No decision · demo auto-accepts', run: () => { if (!decided) feed.decide('accept'); }},
    {at: 13500, caption: 'Failed · agent-provided reason', events: [{type: 'agent.phase', droneId: 'U2', phase: 'failed', action: 'Intercept T6', reason: 'No firing lane: wall blocks approach'}]},
    {at: 16500, caption: 'Completed', events: [{type: 'agent.phase', droneId: 'U1', phase: 'completed', action: 'T4 engagement complete'}, {type: 'voice.status', status: 'idle'}]},
    {at: 18500, caption: 'New plan · press V (Recall) now to override it', events: [{type: 'agent.phase', droneId: 'U1', phase: 'executing', action: 'Intercept T2', reason: 'T2 flanking the pilot', targetId: 'T2'}, {type: 'agent.phase', droneId: 'U2', phase: 'planning', action: 'Re-routing'}]},
    {at: 23000, caption: 'Recall override (simulated if V was not pressed)', run: () => { if (feed.noteRecall()) feed.publish({type: 'voice.response', text: 'Recall acknowledged. All units returning.'}); }},
    {at: 26000, caption: 'Voice error state', events: [{type: 'voice.status', status: 'error', message: 'Microphone unavailable (simulated) · keyboard and gestures still active'}]},
    {at: 29000, caption: 'Restarting demo cycle', events: [{type: 'agent.clear'}, {type: 'agent.suggestion', suggestion: null}, {type: 'voice.status', status: 'idle'}]},
  ];

  function cycle() {
    decided = false;
    for (const s of steps) at(s.at, () => { caption.textContent = s.caption; if (s.events) pub(...s.events); s.run?.(); });
    at(30000, cycle);
  }
  // Begin once the arena is on screen, so every state is visible from the start.
  const waitForArena = () => { if (stopped) return; if (!host.hidden && host.clientWidth > 0) cycle(); else timers.push(window.setTimeout(waitForArena, 400)); };
  caption.textContent = 'Enter the arena to start the demo cycle';
  waitForArena();
  return () => { stopped = true; timers.forEach(clearTimeout); timers = []; off(); banner.remove(); feed.reset(); };
}
