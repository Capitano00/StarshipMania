import { targetIds, type TargetId } from '../contracts'

export type DroneWorkerId = 'U1' | 'U2'
export type DroneWorkerProvider = 'ollama' | 'openai'

export interface DroneWorkerInput {
  unit: DroneWorkerId
  busy: boolean
  candidates: { target: TargetId; distance: number }[]
}

export interface WorkerRequest {
  objective: string
  workers: DroneWorkerInput[]
}

export interface DroneWorkerDecision {
  target: TargetId | null
  reason: string
}

export interface WorkerResponse {
  provider: DroneWorkerProvider
  workers: (DroneWorkerDecision & { unit: DroneWorkerId })[]
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validTarget(value: unknown): value is TargetId {
  return typeof value === 'string' && targetIds.includes(value as TargetId)
}

function validWorker(value: unknown): value is DroneWorkerInput {
  if (!record(value) || Object.keys(value).length !== 3 ||
      (value.unit !== 'U1' && value.unit !== 'U2') || typeof value.busy !== 'boolean' ||
      !Array.isArray(value.candidates) || value.candidates.length > targetIds.length) return false
  const targets = new Set<TargetId>()
  for (const candidate of value.candidates) {
    if (!record(candidate) || Object.keys(candidate).length !== 2 || !validTarget(candidate.target) ||
        typeof candidate.distance !== 'number' || !Number.isFinite(candidate.distance) || candidate.distance < 0 ||
        targets.has(candidate.target)) return false
    targets.add(candidate.target)
  }
  return true
}

export function isWorkerRequest(value: unknown): value is WorkerRequest {
  if (!record(value) || Object.keys(value).length !== 2 || typeof value.objective !== 'string' ||
      !value.objective.trim() || value.objective.length > 160 || !Array.isArray(value.workers) ||
      value.workers.length !== 2 || !value.workers.every(validWorker)) return false
  return value.workers[0].unit !== value.workers[1].unit
}

export function isWorkerDecision(value: unknown, worker: DroneWorkerInput): value is DroneWorkerDecision {
  if (!record(value) || typeof value.reason !== 'string' || !value.reason.trim() ||
      value.reason.length > 160) return false
  return value.target === null ||
    (!worker.busy && worker.candidates.some(candidate => candidate.target === value.target))
}

export async function requestDroneWorkers(request: WorkerRequest, signal?: AbortSignal): Promise<WorkerResponse> {
  const response = await fetch('/drone-workers', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  })
  const reply: unknown = await response.json()
  if (!response.ok) {
    throw new Error(record(reply) && typeof reply.error === 'string' ? reply.error : 'Drone workers are unavailable.')
  }
  if (!record(reply) || (reply.provider !== 'ollama' && reply.provider !== 'openai') ||
      !Array.isArray(reply.workers) || reply.workers.length !== request.workers.length) {
    throw new Error('Invalid drone worker response.')
  }
  const decisions: WorkerResponse['workers'] = []
  for (const worker of request.workers) {
    const decision: unknown = reply.workers.find(entry => record(entry) && entry.unit === worker.unit)
    if (!isWorkerDecision(decision, worker)) throw new Error('Invalid drone worker decision.')
    const { target, reason } = decision
    decisions.push({ unit: worker.unit, target, reason })
  }
  return { provider: reply.provider, workers: decisions }
}
