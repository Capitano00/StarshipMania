import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

const agentHost = 'api.elevenlabs.io';
const require = createRequire(import.meta.url);

export function voiceSession(apiKey?: string, agentId?: string): Plugin {
  const worklets = new Map(['rawAudioProcessor', 'audioConcatProcessor'].map(name => {
    const file = `${name}.js`;
    return [`/voice-worklets/${file}`, readFileSync(require.resolve(`@elevenlabs/client/worklets/${file}`))];
  }));
  worklets.set('/voice-worklets/libsamplerate.worklet.js', readFileSync(require.resolve('@alexanderolsen/libsamplerate-js/dist/libsamplerate.worklet.js')));
  let pending = false;

  function localMiddleware(port: number) {
    const host = `127.0.0.1:${port}`;
    return async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
      const worklet = worklets.get(request.url ?? '');
      if (worklet && request.method === 'GET') {
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        response.end(worklet);
        return;
      }
      if (request.url !== '/voice-session') { next(); return; }

      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      function send(status: number, body: object) {
        response.statusCode = status;
        response.end(JSON.stringify(body));
      }
      if (request.method !== 'POST' || request.headers.host !== host || request.headers.origin !== `http://${host}`) {
        send(403, { error: 'Voice must start from the local game.' });
        return;
      }
      if (!apiKey || !agentId || !/^agent_[a-z0-9]+$/i.test(agentId)) {
        send(503, { error: 'Voice is not configured on the local server.' });
        return;
      }
      if (pending) { send(429, { error: 'A voice session is already starting.' }); return; }
      pending = true;
      try {
        const url = new URL(`https://${agentHost}/v1/convai/conversation/get-signed-url`);
        url.searchParams.set('agent_id', agentId);
        url.searchParams.set('include_conversation_id', 'true');
        const upstream = await fetch(url, { headers: { 'xi-api-key': apiKey }, signal: AbortSignal.timeout(8000) });
        if (!upstream.ok) throw new Error('Session request refused');
        const { signed_url: signedUrl } = await upstream.json();
        const signed = new URL(signedUrl);
        if (signed.protocol !== 'wss:' || signed.host !== agentHost || signed.pathname !== '/v1/convai/conversation') {
          throw new Error('Unexpected session endpoint');
        }
        send(200, { signedUrl });
      } catch {
        send(502, { error: 'ElevenLabs voice session unavailable.' });
      } finally {
        pending = false;
      }
    };
  }

  return {
    name: 'local-voice-session',
    configureServer(server) { server.middlewares.use(localMiddleware(server.config.server.port ?? 4180)); },
    configurePreviewServer(server) { server.middlewares.use(localMiddleware(server.config.preview.port ?? 4180)); },
  };
}
