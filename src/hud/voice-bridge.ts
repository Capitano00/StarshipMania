/**
 * Maps the real ElevenLabs voice session (src/voice-recall.ts) onto the HUD voice panel.
 * Only genuine states and transcript/response events are forwarded; nothing is invented.
 * The voice Recall itself (recall_drones and its safeguards) is untouched.
 */
import type {VoiceEvent, VoiceStatus as SessionStatus} from '../voice-recall';
import type {HudFeed} from './feed';

export function createVoiceHudBridge(feed: Pick<HudFeed, 'publish'>) {
  const agentText = new Map<string, string>();
  return {
    status(state: SessionStatus, detail?: string) {
      if (state === 'off') { agentText.clear(); feed.publish({type: 'voice.status', status: 'unavailable'}); }
      else if (state === 'connecting') feed.publish({type: 'voice.status', status: 'processing', message: 'Connecting to voice'});
      else if (state === 'listening') feed.publish({type: 'voice.status', status: 'listening'});
      else if (state === 'speaking') feed.publish({type: 'voice.status', status: 'responding'});
      else feed.publish({type: 'voice.status', status: 'error', message: detail || 'Voice unavailable · keyboard and gestures still active'});
    },
    event(e: VoiceEvent) {
      if (e.type === 'awaiting-tool') { feed.publish({type: 'voice.status', status: 'processing'}); return; }
      if (e.type === 'interrupted' || e.type === 'result') return; // shown in the Voice tab; no HUD equivalent to fabricate
      if (e.speaker === 'You') {
        if (e.type === 'draft') feed.publish({type: 'voice.transcript', text: e.text, final: false});
        else if (e.type === 'final') feed.publish({type: 'voice.transcript', text: e.text, final: true});
        return;
      }
      const text = e.type === 'append' ? (agentText.get(e.id) ?? '') + e.text : e.text;
      agentText.set(e.id, text);
      if (agentText.size > 20) agentText.delete(agentText.keys().next().value!);
      feed.publish({type: 'voice.response', text});
    },
  };
}
