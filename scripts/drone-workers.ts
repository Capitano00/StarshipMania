import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import {
  isWorkerDecision, isWorkerRequest, type DroneWorkerInput, type DroneWorkerProvider,
  type WorkerRequest, type WorkerResponse,
} from '../src/agent/drone-worker-contract'

const maxRequestBytes = 4096
const localTimeoutMs = 5000
const cloudTimeoutMs = 15000

class WorkerError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

function providerFrom(env: NodeJS.ProcessEnv): DroneWorkerProvider {
  const provider = env.DRONE_WORKER_PROVIDER || 'ollama'
  if (provider !== 'ollama' && provider !== 'openai') {
    throw new WorkerError(503, 'Drone worker provider must be ollama or openai.')
  }
  return provider
}

function decisionSchema(worker: DroneWorkerInput) {
  return {
    type: 'object',
    properties: {
      target: { type: ['string', 'null'], enum: [null, ...(!worker.busy ? worker.candidates.map(c => c.target) : [])] },
      reason: { type: 'string' },
    },
    required: ['target', 'reason'],
    additionalProperties: false,
  }
}

const instruction = 'You are one drone in a fictional arena game. Return one JSON object with target and reason. If busy or no candidate, return null target. Otherwise pick an eligible target that fits the objective. Explain in eight words or fewer using the given facts.'

export async function runDroneWorkers(
  request: WorkerRequest,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
  fetchModel: typeof fetch = fetch,
): Promise<WorkerResponse> {
  const provider = providerFrom(env)
  if (provider === 'openai' && !env.OPENAI_API_KEY) {
    throw new WorkerError(503, 'OpenAI drone workers need a server-side API key.')
  }
  const workers = await Promise.all(request.workers.map(async worker => {
    const schema = decisionSchema(worker)
    const input = JSON.stringify({ objective: request.objective, ...worker })
    const ollama = provider === 'ollama'
    const url = ollama ? 'http://127.0.0.1:11434/api/chat' : 'https://api.openai.com/v1/responses'
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (!ollama) headers.authorization = `Bearer ${env.OPENAI_API_KEY}`
    const body = ollama ? {
      model: env.DRONE_WORKER_OLLAMA_MODEL || 'qwen3.5:2b-q4_K_M',
      stream: false,
      think: false,
      keep_alive: '15m',
      options: { temperature: 0, num_predict: 96 },
      format: schema,
      messages: [{ role: 'system', content: instruction }, { role: 'user', content: input }],
    } : {
      model: env.DRONE_WORKER_OPENAI_MODEL || 'gpt-5-mini',
      store: false,
      reasoning: { effort: 'minimal' },
      max_output_tokens: 256,
      instructions: instruction,
      input,
      text: { format: { type: 'json_schema', name: 'drone_decision', strict: true, schema } },
    }
    const response = await fetchModel(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
    if (!response.ok) throw new WorkerError(502, `${provider} drone worker request failed.`)
    const upstream = await response.json()
    const output = ollama ? upstream.message?.content : upstream.output?.find(
      (item: { type?: string }) => item.type === 'message',
    )?.content?.find((item: { type?: string }) => item.type === 'output_text')?.text
    if (typeof output !== 'string') throw new WorkerError(502, `${provider} returned no drone decision.`)
    let decision: unknown
    try {
      decision = JSON.parse(output)
    } catch {
      throw new WorkerError(502, `${provider} returned malformed drone output.`)
    }
    if (!isWorkerDecision(decision, worker)) {
      throw new WorkerError(502, `${provider} returned an invalid decision for ${worker.unit}.`)
    }
    return { unit: worker.unit, target: decision.target, reason: decision.reason }
  }))
  return { provider, workers }
}

function readRequest(request: IncomingMessage, signal: AbortSignal): Promise<WorkerRequest> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let bytes = 0

    function cleanUp() {
      request.off('data', onData)
      request.off('end', onEnd)
      request.off('error', onError)
      signal.removeEventListener('abort', onAbort)
    }
    function fail(error: unknown) {
      cleanUp()
      reject(error)
    }
    function onAbort() { fail(signal.reason) }
    function onError() { fail(new WorkerError(400, 'Could not read drone worker input.')) }
    function onData(chunk: Buffer) {
      bytes += chunk.length
      if (bytes > maxRequestBytes) {
        fail(new WorkerError(413, 'Drone worker input is too large.'))
        request.resume()
        return
      }
      chunks.push(chunk)
    }
    function onEnd() {
      try {
        const payload: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        if (!isWorkerRequest(payload)) throw new Error('Invalid drone worker request')
        cleanUp()
        resolve(payload)
      } catch {
        fail(new WorkerError(400, 'Invalid drone worker input.'))
      }
    }
    if (signal.aborted) { onAbort(); return }
    request.on('data', onData)
    request.once('end', onEnd)
    request.once('error', onError)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export function droneWorkers(env: NodeJS.ProcessEnv): Plugin {
  let pending = false
  function middleware(port: number) {
    const host = `127.0.0.1:${port}`
    return async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
      if (request.url !== '/drone-workers') { next(); return }
      response.setHeader('Cache-Control', 'no-store')
      response.setHeader('Content-Type', 'application/json; charset=utf-8')
      function send(status: number, body: object) {
        if (response.destroyed) return
        response.statusCode = status
        response.end(JSON.stringify(body))
      }
      if (request.method !== 'POST' || request.headers.host !== host || request.headers.origin !== `http://${host}`) {
        send(403, { error: 'Drone workers must be called from the local game.' })
        return
      }
      if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
        send(415, { error: 'Drone workers expect JSON input.' })
        return
      }
      if (pending) { send(429, { error: 'Drone workers are already considering an order.' }); return }
      pending = true
      const disconnect = new AbortController()
      response.once('close', () => disconnect.abort())
      let provider: DroneWorkerProvider | undefined
      let deadline: AbortSignal | undefined
      try {
        provider = providerFrom(env)
        deadline = AbortSignal.timeout(provider === 'ollama' ? localTimeoutMs : cloudTimeoutMs)
        const signal = AbortSignal.any([deadline, disconnect.signal])
        const payload = await readRequest(request, signal)
        send(200, await runDroneWorkers(payload, env, signal))
      } catch (error) {
        if (deadline?.aborted) send(504, { provider, error: `${provider} drone workers timed out.` })
        else if (error instanceof WorkerError) send(error.status, { provider, error: error.message })
        else send(502, { provider, error: `${provider ?? 'Model'} drone workers are unavailable.` })
      } finally {
        disconnect.abort()
        pending = false
      }
    }
  }
  return {
    name: 'local-drone-workers',
    configureServer(server) { server.middlewares.use(middleware(server.config.server.port ?? 4180)) },
    configurePreviewServer(server) { server.middlewares.use(middleware(server.config.preview.port ?? 4180)) },
  }
}
