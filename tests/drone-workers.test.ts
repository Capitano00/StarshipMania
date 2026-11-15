import { describe, expect, it, vi } from 'vitest'
import { runDroneWorkers } from '../scripts/drone-workers'
import { isWorkerRequest, type WorkerRequest } from '../src/agent/drone-worker-contract'

const request: WorkerRequest = {
  objective: 'Intercept the far turret',
  workers: [
    { unit: 'U1', busy: true, candidates: [{ target: 'T3', distance: 20 }] },
    { unit: 'U2', busy: false, candidates: [{ target: 'T3', distance: 14 }] },
  ],
}

describe('drone worker broker', () => {
  it('requires one request per drone and a bounded slate of unique targets', () => {
    expect(isWorkerRequest(request)).toBe(true)
    expect(isWorkerRequest({ ...request, workers: [request.workers[0], request.workers[0]] })).toBe(false)
    expect(isWorkerRequest({ ...request, workers: [{ ...request.workers[0], candidates: [
      { target: 'T3', distance: 19 }, { target: 'T3', distance: 20 },
    ] }, request.workers[1]] })).toBe(false)
  })

  it('dispatches two independent Ollama requests before either completes', async () => {
    const replies: ((response: Response) => void)[] = []
    const inputs: unknown[] = []
    const model = vi.fn<typeof fetch>((url, input) => {
      expect(url).toBe('http://127.0.0.1:11434/api/chat')
      const body = JSON.parse(String(input?.body))
      expect(body.model).toBe('qwen3.5:2b-q4_K_M')
      inputs.push(JSON.parse(body.messages[1].content))
      return new Promise(resolve => replies.push(resolve))
    })
    const pending = runDroneWorkers(request, {}, new AbortController().signal, model)
    expect(model).toHaveBeenCalledTimes(2)
    expect(inputs).toEqual(request.workers.map(worker => ({ objective: request.objective, ...worker })))
    replies[1](Response.json({ message: { content: '{"target":"T3","reason":"Closest available assignment."}' } }))
    replies[0](Response.json({ message: { content: '{"target":null,"reason":"Busy."}' } }))
    await expect(pending).resolves.toEqual({
      provider: 'ollama',
      workers: [
        { unit: 'U1', target: null, reason: 'Busy.' },
        { unit: 'U2', target: 'T3', reason: 'Closest available assignment.' },
      ],
    })
  })

  it('rejects a busy drone claiming an assignment or an invented target', async () => {
    const model = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({
      message: { content: '{"target":"T3","reason":"Busy but proposing anyway."}' },
    })).mockResolvedValueOnce(Response.json({
      message: { content: '{"target":"T4","reason":"Not a candidate."}' },
    }))
    await expect(runDroneWorkers(request, {}, new AbortController().signal, model)).rejects.toThrow('invalid decision')
  })

  it('uses the cloud adapter only when explicitly configured with a server-side key', async () => {
    const model = vi.fn<typeof fetch>((url, init) => {
      expect(url).toBe('https://api.openai.com/v1/responses')
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-key')
      const body = JSON.parse(String(init?.body))
      expect(body.model).toBe('gpt-5-mini')
      expect(body.text.format.strict).toBe(true)
      return Promise.resolve(Response.json({ output: [{
        type: 'message', content: [{ type: 'output_text', text: '{"target":null,"reason":"Unavailable."}' }],
      }] }))
    })
    const signal = new AbortController().signal
    await expect(runDroneWorkers(request, { DRONE_WORKER_PROVIDER: 'openai' }, signal, model))
      .rejects.toThrow('server-side API key')
    expect(model).not.toHaveBeenCalled()
    await expect(runDroneWorkers(request, { DRONE_WORKER_PROVIDER: 'openai', OPENAI_API_KEY: 'test-key' }, signal, model))
      .resolves.toMatchObject({ provider: 'openai' })
    expect(model).toHaveBeenCalledTimes(2)
  })
})
