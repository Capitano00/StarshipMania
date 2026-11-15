type RequestRecall = () => boolean;
export type VoiceStatus = 'off' | 'connecting' | 'listening' | 'speaking' | 'unavailable';
export type VoiceEvent =
  | { type: 'draft' | 'append' | 'final' | 'correct'; speaker: 'You' | 'Agent'; id: string; text: string }
  | { type: 'interrupted' }
  | { type: 'awaiting-tool' }
  | { type: 'result'; text: 'Recall accepted' | 'Recall ignored' };
type Attempt = { abort: AbortController; turn: RecallTurn; end?: () => Promise<void> };

const recallPhrase = /^recall (?:the )?drones[.!]?$/i;
const maxTurnAgeMs = 8000;

export class RecallTurn {
  private heardAt = -Infinity;
  private lastEvent = -1;
  private calls = new Set<string>();

  hear(text: string, eventId: number, now: number) {
    if (!Number.isSafeInteger(eventId) || eventId <= this.lastEvent) return false;
    this.lastEvent = eventId;
    this.heardAt = recallPhrase.test(text.trim()) ? now : -Infinity;
    return true;
  }

  invalidate() { this.heardAt = -Infinity; }

  consume(id: string, eventId: number, now: number) {
    if (!id || !Number.isSafeInteger(eventId) || eventId < this.lastEvent || this.calls.has(id) || this.calls.size >= 1024) return false;
    this.calls.add(id);
    const fresh = now >= this.heardAt && now - this.heardAt <= maxTurnAgeMs;
    this.invalidate();
    return fresh;
  }
}

type ClientToolHandler = (parameters: unknown) => string | Promise<string>;

/**
 * Client tools for one voice session: optional supervisor tools (src/agent/tools.ts, as JSON-string
 * handlers) plus the guarded recall_drones handler. recall_drones can never be replaced, and the
 * supervisor tools answer only while this session is the active one.
 */
export function voiceClientTools<R, Output extends ReturnType<ClientToolHandler> = string>(recallDrones: R, supervisorTools: Record<string, (parameters: unknown) => Output> = {}, isActive: () => boolean = () => true): Record<string, (parameters: unknown) => Output | string> & {recall_drones: R} {
  const tools: Record<string, (parameters: unknown) => Output | string> = {};
  for (const [name, handler] of Object.entries(supervisorTools)) {
    if (name === 'recall_drones') continue;
    tools[name] = parameters => isActive() ? handler(parameters) : JSON.stringify({ok: false, code: 'unavailable', error: 'The voice session has ended.'});
  }
  return {...tools, recall_drones: recallDrones} as unknown as Record<string, (parameters: unknown) => Output | string> & {recall_drones: R};
}

export function createVoiceRecall(
  requestRecall: RequestRecall,
  report: (state: VoiceStatus, detail?: string) => void,
  display: (event: VoiceEvent) => void,
  /** Optional: supervisor tools to expose to the same ElevenLabs agent (they must also be declared on that agent). */
  supervisorTools?: () => Record<string, ClientToolHandler>,
) {
  let active: Attempt | undefined;
  let sessionNumber = 0;

  function stop() {
    const attempt = active;
    active = undefined;
    attempt?.abort.abort();
    if (attempt?.end) void attempt.end().catch(() => undefined);
    report('off');
  }

  async function start() {
    if (active) return;
    const attempt: Attempt = { abort: new AbortController(), turn: new RecallTurn() };
    active = attempt;
    const session = ++sessionNumber;
    const transcriptId = (id: string | number) => `${session}:${id}`;
    let call: { id: string; eventId: number } | undefined;
    report('connecting');
    try {
      const response = await fetch('/voice-session', { method: 'POST', signal: attempt.abort.signal });
      if (!response.ok) throw new Error('session unavailable');
      const { signedUrl } = await response.json();
      const { Conversation } = await import('@elevenlabs/client');
      if (active !== attempt) return;
      const conversation = await Conversation.startSession({
        signedUrl,
        connectionType: 'websocket',
        workletPaths: {
          rawAudioProcessor: '/voice-worklets/rawAudioProcessor.js',
          audioConcatProcessor: '/voice-worklets/audioConcatProcessor.js',
        },
        libsampleratePath: '/voice-worklets/libsamplerate.worklet.js',
        onConversationCreated: session => { attempt.end = () => session.endSession(); },
        onIncomingEvent: event => {
          if (active !== attempt) return;
          // This event is delivered by the WebSocket SDK but absent from its incoming-event union.
          if ('tentative_user_transcription_event' in event) {
            const draft = event.tentative_user_transcription_event as { event_id?: unknown; user_transcript?: unknown } | null;
            if (draft && typeof draft.event_id === 'number' && typeof draft.user_transcript === 'string') {
              display({ type: 'draft', speaker: 'You', id: transcriptId(draft.event_id), text: draft.user_transcript });
            }
          }
          if (event.type === 'user_transcript') {
            const { user_transcript, event_id } = event.user_transcription_event;
            if (attempt.turn.hear(user_transcript, event_id, performance.now())) {
              display({ type: 'awaiting-tool' });
            }
          }
          if (event.type === 'interruption') {
            attempt.turn.invalidate();
            display({ type: 'interrupted' });
          }
          if (event.type === 'client_tool_call' && event.client_tool_call.tool_name === 'recall_drones') {
            const { tool_call_id, event_id, parameters } = event.client_tool_call;
            call = parameters && !Array.isArray(parameters) && Object.keys(parameters).length === 0
              ? { id: tool_call_id, eventId: event_id } : undefined;
          }
        },
        onMessage: ({ role, event_id, response_id, message }) => {
          if (active !== attempt || (role !== 'user' && role !== 'agent')) return;
          display({ type: 'final', speaker: role === 'user' ? 'You' : 'Agent', id: transcriptId(response_id ?? event_id), text: message });
        },
        onAgentChatResponsePart: ({ type, response_id, event_id, text }) => {
          if (active === attempt && type === 'delta') {
            display({ type: 'append', speaker: 'Agent', id: transcriptId(response_id ?? event_id), text });
          }
        },
        onAgentResponseCorrection: ({ event_id, response_id, corrected_agent_response }) => {
          if (active === attempt) display({ type: 'correct', speaker: 'Agent', id: transcriptId(response_id ?? event_id), text: corrected_agent_response });
        },
        clientTools: voiceClientTools(() => {
            const request = call;
            call = undefined;
            if (active !== attempt || !request || !attempt.turn.consume(request.id, request.eventId, performance.now()) || !requestRecall()) {
              if (active === attempt) display({ type: 'result', text: 'Recall ignored' });
              throw new Error('The game did not accept the recall request.');
            }
            display({ type: 'result', text: 'Recall accepted' });
            return 'The game accepted Recall. The browser received the recall request.';
          }, supervisorTools?.() ?? {}, () => active === attempt),
        onConnect: () => { if (active === attempt) report('listening'); },
        onModeChange: ({ mode }) => {
          if (active === attempt) report(mode === 'speaking' ? 'speaking' : 'listening');
        },
        onDisconnect: () => {
          if (active !== attempt) return;
          active = undefined;
          report('unavailable', 'Voice disconnected');
        },
      });
      if (active !== attempt) await conversation.endSession();
    } catch (error) {
      if (active !== attempt) return;
      active = undefined;
      if (attempt.end) void attempt.end().catch(() => undefined);
      const denied = error instanceof Error && error.name === 'NotAllowedError';
      report('unavailable', denied ? 'Microphone permission denied' : 'Check microphone or local voice setup');
    }
  }

  return { start, stop, invalidate: () => active?.turn.invalidate() };
}
