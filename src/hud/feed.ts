/**
 * The single integration point for future agent and voice features.
 *
 * Defaults are honest: voice "unavailable", agent link "offline", no suggestion. The HUD
 * renders exactly what is pushed here and never invents agent activity. Accept / Dismiss
 * only become enabled once gameplay registers decision handlers; arbitration (including
 * "Recall always wins") stays in gameplay code, which reports the result back through
 * `setSuggestion({...status})`.
 */
import type {AgentTargetMark, DroneAgentHud, DroneTelemetry, HudEvent, HudInputEvent, LinkState, SuggestionHud, VoiceHud} from './contract';

export type DecisionHandlers = {accept: (suggestionId: string) => void; dismiss: (suggestionId: string) => void};

export class HudFeed {
  suggestion: SuggestionHud | null = null;
  voice: VoiceHud = {status: 'unavailable'};
  agentLink: LinkState = 'offline';
  telemetry: Record<string, DroneTelemetry> = {};
  agentEvents: HudEvent[] = [];
  /** Increments on every change so the HUD can re-render only when needed. */
  version = 0;
  private handlers: DecisionHandlers | null = null;

  private bump() { this.version++; }
  setSuggestion(suggestion: SuggestionHud | null) { this.suggestion = suggestion ? {...suggestion} : null; this.bump(); }
  setVoice(voice: VoiceHud) { this.voice = {...voice}; this.bump(); }
  setAgentLink(state: LinkState) { this.agentLink = state; this.bump(); }
  setDroneTelemetry(droneId: string, telemetry: DroneTelemetry | null) {
    if (telemetry) this.telemetry = {...this.telemetry, [droneId]: {...telemetry}};
    else { const next = {...this.telemetry}; delete next[droneId]; this.telemetry = next; }
    this.bump();
  }
  pushAgentEvent(event: HudEvent) { this.agentEvents = [event, ...this.agentEvents].slice(0, 20); this.bump(); }

  /** Gameplay registers how Accept / Dismiss are applied. Returns an unsubscribe function. */
  onDecision(handlers: DecisionHandlers) { this.handlers = handlers; this.bump(); return () => { if (this.handlers === handlers) { this.handlers = null; this.bump(); } }; }
  get canDecide() { return !!this.handlers && this.suggestion?.status === 'pending'; }
  decide(kind: 'accept' | 'dismiss') {
    const suggestion = this.suggestion;
    if (!this.handlers || !suggestion || suggestion.status !== 'pending') return false;
    this.handlers[kind](suggestion.id);
    return true;
  }

  // ---------- Event API for voice and agent integrations ----------
  agents: Record<string, DroneAgentHud> = {};
  constructor(private now: () => number = () => performance.now()) {}

  /** Single entry point for teammates: publish provider-neutral voice/agent events. */
  publish(event: HudInputEvent) {
    switch (event.type) {
      case 'voice.status': {
        const fresh = event.status === 'listening' && this.voice.status !== 'listening';
        this.voice = fresh ? {status: 'listening'} : {...this.voice, status: event.status, message: event.message};
        if (event.status === 'unavailable' || event.status === 'idle') this.voice = {status: event.status};
        break;
      }
      case 'voice.transcript':
        this.voice = event.final
          ? {...this.voice, status: 'transcribing', final: event.text, partial: undefined}
          : {...this.voice, status: 'transcribing', partial: event.text, final: undefined, reply: undefined};
        break;
      case 'voice.response': this.voice = {...this.voice, status: 'responding', reply: event.text}; break;
      case 'agent.link': this.agentLink = event.state; break;
      case 'agent.phase':
        this.agents = {...this.agents, [event.droneId]: {droneId: event.droneId, phase: event.phase, action: event.action, reason: event.reason, targetId: event.targetId, at: this.now()}};
        break;
      case 'agent.suggestion': this.suggestion = event.suggestion ? {...event.suggestion} : null; break;
      case 'agent.clear': {
        if (event.droneId) { const next = {...this.agents}; delete next[event.droneId]; this.agents = next; }
        else this.agents = {};
        break;
      }
    }
    this.bump();
  }

  /**
   * Display-level Recall override, called by the HUD when the simulation accepts a Recall.
   * Active agent work is shown as recalled and a pending suggestion closes. Gameplay still
   * owns arbitration; later publishes display normally.
   */
  noteRecall() {
    let changed = false;
    const next: Record<string, DroneAgentHud> = {};
    for (const [id, a] of Object.entries(this.agents)) {
      if (['planning', 'proposing', 'executing'].includes(a.phase)) { next[id] = {...a, phase: 'recalled', at: this.now()}; changed = true; }
      else next[id] = a;
    }
    this.agents = next;
    if (this.suggestion?.status === 'pending' || this.suggestion?.status === 'accepted') { this.suggestion = {...this.suggestion, status: 'recalled'}; changed = true; }
    if (changed) this.bump();
    return changed;
  }

  /** Targets the 3D layer should highlight because an agent is proposing or executing on them. */
  targetMarks(): AgentTargetMark[] {
    return Object.values(this.agents).flatMap(a => a.targetId && (a.phase === 'proposing' || a.phase === 'executing')
      ? [{targetId: a.targetId, phase: a.phase, droneId: a.droneId, since: a.at}] : []);
  }

  reset() { this.suggestion = null; this.voice = {status: 'unavailable'}; this.agentLink = 'offline'; this.telemetry = {}; this.agentEvents = []; this.agents = {}; this.handlers = null; this.bump(); }
}

export const hudFeed = new HudFeed();
