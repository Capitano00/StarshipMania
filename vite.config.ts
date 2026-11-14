import { defineConfig } from 'vite';
import {securityHeaders} from './src/security';
import {voiceSession} from './scripts/voice-session';

export function localGameConfig({ ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID }: NodeJS.ProcessEnv) {
  const enabled = Boolean(ELEVENLABS_API_KEY && /^agent_[a-z0-9]+$/i.test(ELEVENLABS_AGENT_ID ?? ''));
  const headers = enabled ? {
    ...securityHeaders,
    'Content-Security-Policy': securityHeaders['Content-Security-Policy'].replace('connect-src ', 'connect-src wss://api.elevenlabs.io '),
    'Permissions-Policy': securityHeaders['Permissions-Policy'].replace('microphone=()', 'microphone=(self)'),
  } : securityHeaders;
  const local = {host:'127.0.0.1',port:4180,strictPort:true,headers};
  return {
    server: local,
    preview: local,
    plugins: [voiceSession(ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID)],
    build:{target:'es2022'},
  };
}

export default defineConfig(localGameConfig(process.env));
