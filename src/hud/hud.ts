/**
 * StarshipMania tactical HUD (DOM layer). Presentation only.
 *
 * - Restyles the existing arena chrome via `body.hud-v2` (see hud.css); no existing element
 *   is removed or renamed, so gameplay handlers and tests keep their ids.
 * - Adds a squad rail (real drone state), objectives, agent/voice link status, a
 *   recommendation slot (only when hudFeed has one), command toasts, a gesture strip,
 *   a reticle dwell ring, a collapsible tactical rail and a draggable camera preview.
 * - Reads Simulation and a few existing DOM readouts; never writes simulation/controls state.
 */
import './hud.css';
import type {Simulation} from '../simulation';
import type {TargetId} from '../contracts';
import {hudFeed as defaultFeed, type HudFeed} from './feed';
import {droneCards, formatTime, objectives, toHudEvent, toastWorthy} from './model';
import type {DroneHud, HudSeverity, ObjectiveHud} from './contract';
import {mountAgentVoice} from './agent-voice';
import type {Camera} from 'three';

export type HudFrame = {sim: Simulation; preview: TargetId | null; aimed: TargetId | null; camera?: Camera};
export type HudHandle = {update(frame: HudFrame): void; dispose(): void};

type Toast = {node: HTMLElement; born: number};
const TOAST_MS = 2800, MAX_TOASTS = 3;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
const byId = (id: string) => document.getElementById(id);
const pct = (v: number) => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;

const droneMeta: Record<DroneHud['state'], string> = {
  following: 'Escorting pilot', moving: 'En route to target', engaging: 'At firing position', returning: 'Returning to pilot',
  standby: 'No reachable eligible target', blocked: 'Route or firing lane blocked', offline: 'No signal',
};
const objectiveTag: Record<ObjectiveHud['state'], string> = {idle: 'IDLE', armed: 'ARMED', assigned: 'ENGAGED', locked: 'LOCK', down: 'DOWN'};

export function mountHud(feed: HudFeed = defaultFeed): HudHandle | null {
  // Same guard as the inspector: the arena chrome only exists in a real browser layout.
  if (typeof ResizeObserver === 'undefined' || typeof document === 'undefined') return null;
  const arena = byId('arena'), inspector = byId('arena-inspector');
  if (!arena || !inspector) return null;
  document.body.classList.add('hud-v2');

  // ----- Left rail: squad + objectives -----
  const left = h('aside', 'hud-panel hud-left');
  left.setAttribute('aria-label', 'Squad status and objectives');
  const squadHead = h('div', 'hud-head');
  squadHead.append(h('span', 'hud-eyebrow hud-accent', 'Squad · Padisarah'));
  const squadCount = h('span', 'hud-mono hud-dim'); squadHead.append(squadCount);
  const drones = h('div', 'hud-drones');
  const objHead = h('div', 'hud-head');
  objHead.append(h('span', 'hud-eyebrow', 'Objectives'));
  const objCount = h('span', 'hud-mono hud-dim'); objHead.append(objCount);
  const targets = h('ol', 'hud-targets');
  left.append(squadHead, drones, objHead, targets);

  // ----- Agent block at the top of the tactical (right) rail -----
  const agent = h('section', 'hud-agent');
  agent.setAttribute('aria-label', 'Agent and voice link');
  const links = h('div', 'hud-links');
  const voiceChip = h('span', 'hud-chip'), agentChip = h('span', 'hud-chip');
  links.append(voiceChip, agentChip);
  const transcript = h('p', 'hud-transcript'); transcript.hidden = true; transcript.setAttribute('aria-live', 'polite');
  const rec = h('article', 'hud-rec'); rec.hidden = true; rec.setAttribute('aria-live', 'polite');
  const recHead = h('div', 'hud-rec-head'), recTitle = h('strong', 'hud-rec-title'), recReason = h('p', 'hud-rec-reason'), recStatus = h('span', 'hud-eyebrow hud-rec-status');
  const recActions = h('div', 'hud-rec-actions');
  const accept = h('button', 'hud-btn hud-btn-primary', 'Accept'), dismiss = h('button', 'hud-btn', 'Dismiss');
  accept.type = dismiss.type = 'button';
  accept.onclick = () => { feed.decide('accept'); }; dismiss.onclick = () => { feed.decide('dismiss'); };
  recActions.append(accept, dismiss);
  const recHint = h('small', 'hud-dim', 'Recall always overrides a recommendation');
  rec.append(recHead, recTitle, recReason, recActions, recStatus, recHint);
  agent.append(links, transcript, rec);
  inspector.prepend(agent);

  // ----- Rail collapse toggle -----
  const toggle = h('button', 'hud-rail-toggle', 'Hide panel');
  toggle.type = 'button'; toggle.id = 'hud-rail-toggle'; toggle.setAttribute('aria-controls', 'arena-inspector'); toggle.setAttribute('aria-expanded', 'true');
  toggle.onclick = () => {
    const collapsed = document.body.classList.toggle('hud-rail-collapsed');
    toggle.setAttribute('aria-expanded', String(!collapsed)); toggle.textContent = collapsed ? 'Tactical panel' : 'Hide panel';
  };

  // ----- Toasts, gesture strip, reticle dwell ring -----
  const toastBox = h('div', 'hud-toasts'); toastBox.setAttribute('role', 'status'); toastBox.setAttribute('aria-live', 'polite');
  const strip = h('div', 'hud-gesture');
  strip.setAttribute('aria-label', 'Gesture recognition');
  const hands = h('span', 'hud-mono hud-hands');
  const deploy = h('span', 'hud-cmd'), recall = h('span', 'hud-cmd');
  const dwellTrack = h('span', 'hud-dwell-track'), dwellFill = h('span', 'hud-dwell-fill'); dwellTrack.append(dwellFill);
  strip.append(hands, deploy, dwellTrack, recall);
  const reticle = byId('reticle'), ring = h('span', 'hud-reticle-ring');
  reticle?.append(ring);
  const root = h('div', 'hud-root'); root.id = 'hud-root';
  root.append(left, toastBox, strip, toggle);
  arena.append(root);
  const agentVoice = mountAgentVoice(root, feed, (severity, title, detail) => toast(severity, title, detail, performance.now()));

  // ----- Camera preview: compact, draggable picture-in-picture (tracking reads the hidden <video>, not this canvas) -----
  const preview = arena.querySelector<HTMLElement>('.tracking-preview') ?? document.querySelector<HTMLElement>('.tracking-preview');
  const handle = preview?.querySelector<HTMLElement>('.tracking-heading');
  let drag: {x: number; y: number; left: number; top: number} | null = null;
  const onDown = (e: PointerEvent) => {
    if (!preview || !document.body.contains(preview) || preview.parentElement !== arena || (e.target as HTMLElement).closest('button')) return;
    const box = preview.getBoundingClientRect(), host = arena.getBoundingClientRect();
    drag = {x: e.clientX, y: e.clientY, left: box.left - host.left, top: box.top - host.top};
    handle?.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (!drag || !preview) return;
    const host = arena.getBoundingClientRect(), box = preview.getBoundingClientRect();
    const left = Math.max(4, Math.min(host.width - box.width - 4, drag.left + e.clientX - drag.x));
    const top = Math.max(4, Math.min(host.height - box.height - 4, drag.top + e.clientY - drag.y));
    preview.style.setProperty('--hud-pip-left', `${left}px`); preview.style.setProperty('--hud-pip-top', `${top}px`);
    preview.classList.add('hud-pip-moved');
  };
  const onUp = () => { drag = null; };
  handle?.addEventListener('pointerdown', onDown); handle?.addEventListener('pointermove', onMove); handle?.addEventListener('pointerup', onUp);
  handle?.setAttribute('title', 'Drag to move the camera preview');

  // ----- Render state -----
  let run = '', lastEvent = 0, droneSig = '', objSig = '', feedVersion = -1, stripSig = '';
  const toasts: Toast[] = [];

  function renderDrones(cards: DroneHud[]) {
    const sig = JSON.stringify(cards);
    if (sig === droneSig) return;
    droneSig = sig;
    squadCount.textContent = `${cards.filter(c => c.state !== 'offline').length} / ${cards.length} online`;
    drones.replaceChildren(...cards.map(c => {
      const card = h('article', 'hud-drone'); card.dataset.state = c.state; card.dataset.authority = c.authority;
      const head = h('div', 'hud-drone-head');
      head.append(h('strong', 'hud-callsign', c.callsign), h('span', 'hud-eyebrow hud-dim', 'Padisarah unit'), h('span', 'hud-tag', c.authority === 'pilot' ? 'MANUAL' : c.authority === 'auto' ? 'AUTO · FAW' : 'AGENT'));
      const task = h('div', 'hud-task', c.task.label);
      const meter = h('div', 'hud-meter'); const fill = h('span'); fill.style.width = pct(c.targetHull ?? 0); meter.append(fill); meter.hidden = c.targetHull === null;
      meter.title = c.targetHull === null ? '' : `${c.task.targetId} hull ${pct(c.targetHull)}`;
      const meta = h('small', 'hud-dim', `${c.reason ?? droneMeta[c.state]} · Hull ${c.health === null ? '—' : pct(c.health)}${c.targetHull !== null ? ` · ${c.task.targetId} ${pct(c.targetHull)}` : ''}`);
      card.append(head, task, meter, meta);
      return card;
    }));
  }

  function renderObjectives(list: ObjectiveHud[]) {
    const sig = JSON.stringify(list);
    if (sig === objSig) return;
    objSig = sig;
    objCount.textContent = `${list.filter(o => o.state === 'down').length} / ${list.length} cleared`;
    targets.replaceChildren(...list.map(o => {
      const li = h('li', 'hud-target'); li.dataset.state = o.state;
      li.append(h('b', '', o.id), h('span', '', objectiveTag[o.state]));
      li.title = `${o.id} · ${objectiveTag[o.state]} · hull ${pct(o.hull)}`;
      li.style.setProperty('--hull', String(o.hull));
      return li;
    }));
  }

  function renderAgent() {
    if (feed.version === feedVersion) return;
    feedVersion = feed.version;
    const voice = feed.voice;
    const voiceLive = voice.status !== 'unavailable' && voice.status !== 'error';
    voiceChip.dataset.state = voiceLive ? 'live' : 'offline';
    voiceChip.replaceChildren(h('i'), h('b', '', 'Voice'), h('span', '', voiceLive ? voice.status.toUpperCase() : voice.status === 'error' ? 'ERROR' : 'NOT CONNECTED'));
    agentChip.dataset.state = feed.agentLink;
    agentChip.replaceChildren(h('i'), h('b', '', 'Agent'), h('span', '', feed.agentLink === 'live' ? 'LINKED' : 'NOT CONNECTED'));
    const words = voice.partial || voice.final || voice.reply;
    transcript.hidden = !voiceLive || !words;
    transcript.textContent = voice.reply ? `Agent: ${voice.reply}` : words ? `“${words}”` : '';
    transcript.dataset.partial = String(!!voice.partial && !voice.final);
    const s = feed.suggestion;
    rec.hidden = !s;
    if (!s) return;
    rec.dataset.status = s.status;
    recHead.replaceChildren(h('i'), h('span', 'hud-eyebrow', `Agent recommendation · ${s.droneId}`));
    recTitle.textContent = s.action;
    recReason.textContent = `Reason: ${s.reason}`;
    recStatus.textContent = s.status === 'pending' ? 'Awaiting your call' : s.status === 'accepted' ? 'Accepted · executing' : s.status === 'dismissed' ? 'Dismissed' : s.status === 'recalled' ? 'Recall override · cleared' : 'Expired';
    recActions.hidden = s.status !== 'pending';
    recStatus.hidden = s.status === 'pending';
    accept.disabled = dismiss.disabled = !feed.canDecide;
  }

  function toast(severity: HudSeverity, title: string, detail: string, now: number) {
    const node = h('div', 'hud-toast'); node.dataset.severity = severity;
    node.append(h('span', 'hud-eyebrow', title), h('strong', 'hud-mono', detail));
    toastBox.prepend(node);
    toasts.unshift({node, born: now});
    while (toasts.length > MAX_TOASTS) toasts.pop()!.node.remove();
  }

  function renderStrip(preview: TargetId | null) {
    const dwellNode = byId('dwell') as HTMLProgressElement | null;
    const dwell = dwellNode && dwellNode.max > 0 ? dwellNode.value / dwellNode.max : 0;
    const tracking = byId('tracking-line')?.textContent ?? '';
    const dep = byId('command-deploy-state')?.textContent ?? '—', rec2 = byId('command-recall-state')?.textContent ?? '—';
    const sig = `${tracking}|${dep}|${rec2}|${Math.round(dwell * 40)}|${preview}`;
    if (sig !== stripSig) {
      stripSig = sig;
      hands.textContent = tracking.replace(/Left:/, 'L').replace(/Right:/, 'R').replace(' / ', ' · ') || 'L — · R —';
      deploy.replaceChildren(h('b', '', 'Deploy'), h('span', '', dep)); deploy.dataset.ready = String(/ready|hold/i.test(dep));
      recall.replaceChildren(h('b', '', 'Recall'), h('span', '', rec2)); recall.dataset.ready = String(/ready|hold/i.test(rec2));
      dwellFill.style.width = pct(dwell);
      dwellTrack.title = preview ? `Holding on ${preview}` : 'Hold to commit';
    }
    if (reticle) {
      reticle.style.setProperty('--hud-dwell', String(Math.max(0, Math.min(1, dwell))));
      reticle.classList.toggle('hud-locked', !!preview);
    }
  }

  return {
    update({sim, preview, camera}: HudFrame) {
      const now = performance.now();
      if (sim.runId !== run) {
        run = sim.runId; lastEvent = sim.events.entries[0]?.id ?? 0;
        for (const t of toasts.splice(0)) t.node.remove();
      }
      renderDrones(droneCards(sim, feed.telemetry));
      renderObjectives(objectives(sim, preview));
      renderAgent();
      renderStrip(preview);
      const fresh = sim.events.entries.filter(e => e.id > lastEvent);
      if (fresh.length) lastEvent = fresh[0].id;
      for (const e of fresh.reverse()) if (toastWorthy(e)) { const ev = toHudEvent(e); toast(ev.severity, ev.title, e.action === 'Voice order' ? ev.detail : `${e.outcome} · ${formatTime(e.tick)}`, now); }
      agentVoice.update({sim, camera});
      for (let i = toasts.length - 1; i >= 0; i--) if (now - toasts[i].born > TOAST_MS) { toasts[i].node.remove(); toasts.splice(i, 1); }
    },
    dispose() {
      agentVoice.dispose(); root.remove(); agent.remove(); ring.remove();
      handle?.removeEventListener('pointerdown', onDown); handle?.removeEventListener('pointermove', onMove); handle?.removeEventListener('pointerup', onUp);
      document.body.classList.remove('hud-v2', 'hud-rail-collapsed');
    },
  };
}
