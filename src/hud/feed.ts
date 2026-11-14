/**
 * The single integration point for future agent and voice features.
 *
 * Defaults are honest: voice "unavailable", agent link "offline", no suggestion. The HUD
 * renders exactly what is pushed here and never invents agent activity. Accept / Dismiss
 * only become enabled once gameplay registers decision handlers; arbitration (including
 * "Recall always wins") stays in gameplay code, which reports the result back through
 * `setSuggestion({...status})`.
 */
import type {DroneTelemetry, HudEvent, LinkState, SuggestionHud, VoiceHud} from './contract';

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

  reset() { this.suggestion = null; this.voice = {status: 'unavailable'}; this.agentLink = 'offline'; this.telemetry = {}; this.agentEvents = []; this.handlers = null; this.bump(); }
}

export const hudFeed = new HudFeed();
