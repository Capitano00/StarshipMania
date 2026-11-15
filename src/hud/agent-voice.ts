/**
 * Voice indicator + floating drone status tags (DOM), driven only by hudFeed and
 * read-only Simulation state. Designs: Figma page "Agent & Voice" (VoicePanel, DroneTag).
 */
import type * as THREE from 'three';
import {projectToScreen} from './project';
import type {Simulation} from '../simulation';
import type {HudFeed} from './feed';
import type {AgentPhase, HudSeverity, VoiceStatus} from './contract';
import {droneState} from './model';

type Toast = (severity: HudSeverity, title: string, detail: string) => void;
export type AgentVoiceFrame = {sim: Simulation; camera?: THREE.Camera};

const voiceLabel: Record<VoiceStatus, string> = {
  unavailable: 'Voice · not connected', idle: 'Voice ready', listening: 'Listening', transcribing: 'Transcribing',
  processing: 'Processing', responding: 'Agent responding', error: 'Voice error',
};
const phaseLabel: Record<AgentPhase, string> = {
  idle: '', planning: 'Planning', proposing: 'Proposing', executing: 'Executing', completed: 'Completed', failed: 'Failed', recalled: 'Recall override',
};
const simLabel: Record<ReturnType<typeof droneState>, string> = {
  following: 'Escort', moving: 'Intercept', engaging: 'Engaging', returning: 'Returning', standby: 'Standby', blocked: 'Blocked', offline: 'Offline',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function mountAgentVoice(host: HTMLElement, feed: HudFeed, toast: Toast) {
  // ----- Voice panel -----
  const voice = el('section', 'hud-voice');
  voice.setAttribute('aria-label', 'Voice interaction'); voice.setAttribute('aria-live', 'polite');
  const head = el('div', 'hud-voice-head');
  const mic = el('span', 'hud-mic');
  mic.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const label = el('span', 'hud-voice-label');
  const level = el('span', 'hud-voice-level');
  for (let i = 0; i < 5; i++) level.append(el('i'));
  const dots = el('span', 'hud-voice-dots', '• • •');
  head.append(mic, label, level, dots);
  const heard = el('p', 'hud-voice-heard'), reply = el('p', 'hud-voice-reply');
  voice.append(head, heard, reply);

  // ----- Floating drone tags -----
  const tagLayer = el('div', 'hud-tags');
  const tags = new Map<string, {root: HTMLElement; call: HTMLElement; phase: HTMLElement; action: HTMLElement; reason: HTMLElement; sig: string}>();
  host.append(tagLayer, voice);

  let version = -1, run = '', lastEvent = 0;
  const lastPhase = new Map<string, string>();

  function renderVoice() {
    const s = feed.voice;
    voice.dataset.state = s.status;
    voice.hidden = s.status === 'unavailable';
    label.textContent = voiceLabel[s.status];
    heard.textContent = s.final ? `“${s.final}”` : s.partial ? `“${s.partial}…”` : '';
    heard.hidden = !heard.textContent;
    heard.dataset.partial = String(!s.final && !!s.partial);
    reply.textContent = s.status === 'error' ? (s.message ?? 'Voice unavailable · keyboard and gestures still active') : s.reply ?? '';
    reply.hidden = !reply.textContent;
  }

  function tagFor(id: string) {
    let t = tags.get(id);
    if (t) return t;
    const root = el('div', 'hud-tag3d'), box = el('div', 'hud-tag3d-box');
    const row = el('div', 'hud-tag3d-row'), call = el('b', '', id), dot = el('i'), phase = el('span', 'hud-tag3d-phase');
    row.append(call, dot, phase);
    const action = el('div', 'hud-tag3d-action'), reason = el('div', 'hud-tag3d-reason');
    box.append(row, action, reason);
    root.append(box, el('span', 'hud-tag3d-stem'));
    tagLayer.append(root);
    t = {root, call, phase, action, reason, sig: ''};
    tags.set(id, t);
    return t;
  }

  return {
    update({sim, camera}: AgentVoiceFrame) {
      if (sim.runId !== run) { run = sim.runId; lastEvent = sim.events.entries[0]?.id ?? 0; }
      // Recall precedence: as soon as the simulation accepts Recall, show the override.
      const fresh = sim.events.entries.filter(e => e.id > lastEvent);
      if (fresh.length) lastEvent = fresh[0].id;
      if (fresh.some(e => e.action === 'Recall' && e.outcome === 'Accepted') && feed.noteRecall()) toast('critical', 'RECALL OVERRIDE', 'Agent actions cleared · manual control');

      if (feed.version !== version) {
        version = feed.version;
        renderVoice();
        for (const a of Object.values(feed.agents)) {
          const key = a.phase + '|' + a.at;
          if (lastPhase.get(a.droneId) === key) continue;
          const previous = lastPhase.get(a.droneId);
          lastPhase.set(a.droneId, key);
          if (previous === undefined) continue;
          if (a.phase === 'executing') toast('success', `${a.droneId} · ACTION ACCEPTED`, a.action ?? 'Executing');
          else if (a.phase === 'failed') toast('warn', `${a.droneId} · FAILED`, a.reason ?? a.action ?? 'Action failed');
          else if (a.phase === 'completed') toast('info', `${a.droneId} · COMPLETED`, a.action ?? 'Done');
        }
      }

      const w = host.clientWidth, h = host.clientHeight;
      const seen = new Set<string>();
      const placed: {root: HTMLElement; x: number; y: number}[] = [];
      sim.funnels.forEach((f, i) => {
        seen.add(f.id);
        const t = tagFor(f.id);
        const agent = feed.agents[f.id];
        const phase: AgentPhase = agent?.phase ?? 'idle';
        const sig = `${phase}|${agent?.action ?? ''}|${agent?.reason ?? ''}|${agent?.targetId ?? ''}|${droneState(f)}`;
        if (sig !== t.sig) {
          const animate = t.sig !== '' && t.sig.split('|')[0] !== phase;
          t.sig = sig;
          t.root.dataset.phase = phase;
          t.phase.textContent = phase === 'idle' ? simLabel[droneState(f)] : phaseLabel[phase] + (agent?.targetId && phase !== 'recalled' ? ` · ${agent.targetId}` : '');
          t.action.textContent = agent?.action ?? '';
          t.action.hidden = phase === 'idle' || !agent?.action;
          t.reason.textContent = agent?.reason ? `Reason: ${agent.reason}` : '';
          t.reason.hidden = phase === 'idle' || !agent?.reason;
          if (animate) { t.root.classList.remove('hud-tag3d-flash'); void t.root.offsetWidth; t.root.classList.add('hud-tag3d-flash'); }
        }
        if (!camera || !w || !h) { t.root.hidden = true; return; }
        const v = projectToScreen(f.position.x, 1.6 + Math.sin(sim.tick * .08 + i) * .05 + .75, f.position.y, camera);
        const visible = v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
        t.root.hidden = !visible;
        if (visible) placed.push({root: t.root, x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h});
      });
      // De-overlap: drones often fly side by side, so stack colliding tags upward.
      const lifts = placed.map(() => 0);
      for (let i = 0; i < placed.length; i++) for (let j = 0; j < i; j++) {
        const a = placed[j], b = placed[i];
        const boxA = a.root.firstElementChild as HTMLElement | null, boxB = b.root.firstElementChild as HTMLElement | null;
        const half = ((boxA?.offsetWidth ?? 160) + (boxB?.offsetWidth ?? 160)) / 2 + 6;
        const tall = (boxA?.offsetHeight ?? 40) + 6;
        if (Math.abs(a.x - b.x) < half && Math.abs((a.y - lifts[j]) - (b.y - lifts[i])) < tall) lifts[i] = lifts[j] + tall;
      }
      placed.forEach((p, i) => {
        p.root.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
        p.root.style.setProperty('--lift', `${lifts[i]}px`);
      });
      for (const [id, t] of tags) if (!seen.has(id)) t.root.hidden = true;
    },
    dispose() { voice.remove(); tagLayer.remove(); },
  };
}
