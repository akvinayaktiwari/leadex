import type {
  Clock,
  RunErrorInfo,
  RunEvent,
  RunEventsRepository,
  RunJobMessage,
  RunQueueRepository,
  RunRecord,
  RunStatus,
  RunsRepository,
} from '../../src/types/index.js'

// In-memory stand-ins that keep the DynamoDB semantics the services rely on:
// conditional create/append, ordered seq queries, status updates on existing runs only.

export interface MemoryRuns extends RunsRepository {
  items: Map<string, RunRecord>
}

export function memoryRuns(): MemoryRuns {
  const items = new Map<string, RunRecord>()
  return {
    items,
    async create(run: RunRecord): Promise<void> {
      if (items.has(run.runId)) throw new Error('ConditionalCheckFailed')
      items.set(run.runId, { ...run })
    },
    async get(runId: string): Promise<RunRecord | undefined> {
      const run = items.get(runId)
      return run ? { ...run } : undefined
    },
    async setStatus(runId: string, status: RunStatus, updatedAt: string, error?: RunErrorInfo): Promise<void> {
      const run = items.get(runId)
      if (!run) throw new Error('ConditionalCheckFailed')
      const { error: _previous, ...rest } = run
      items.set(runId, { ...rest, status, updatedAt, ...(error ? { error } : {}) })
    },
  }
}

export interface MemoryEvents extends RunEventsRepository {
  all(runId: string): RunEvent[]
  failNextAppend: boolean
}

export function memoryEvents(): MemoryEvents {
  const byRun = new Map<string, RunEvent[]>()
  const all = (runId: string): RunEvent[] => byRun.get(runId) ?? []
  const store: MemoryEvents = {
    all,
    failNextAppend: false,
    async append(runId: string, event: RunEvent): Promise<void> {
      if (store.failNextAppend) {
        store.failNextAppend = false
        throw new Error('ProvisionedThroughputExceeded')
      }
      const events = all(runId)
      if (events.some((existing) => existing.seq === event.seq)) throw new Error('ConditionalCheckFailed')
      byRun.set(runId, [...events, event].sort((a, b) => a.seq - b.seq))
    },
    async listAfter(runId: string, afterSeq: number, limit: number): Promise<RunEvent[]> {
      return all(runId).filter((event) => event.seq > afterSeq).slice(0, limit)
    },
    async lastSeq(runId: string): Promise<number> {
      return all(runId).at(-1)?.seq ?? 0
    },
  }
  return store
}

export interface MemoryQueue extends RunQueueRepository {
  sent: RunJobMessage[]
  failSend: boolean
}

export function memoryQueue(): MemoryQueue {
  const queue: MemoryQueue = {
    sent: [],
    failSend: false,
    async receive() {
      return []
    },
    async remove(): Promise<void> {},
    async send(job: RunJobMessage): Promise<void> {
      if (queue.failSend) throw new Error('SQS unavailable')
      queue.sent.push(job)
    },
  }
  return queue
}

export interface ManualClock extends Clock {
  advance(ms: number): void
}

export function manualClock(start = '2026-10-21T10:00:00.000Z'): ManualClock {
  let current = Date.parse(start)
  return {
    now: () => new Date(current),
    advance: (ms: number) => {
      current += ms
    },
  }
}

export function sampleRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: 'run_1',
    type: 'analysis',
    domain: 'example.com',
    status: 'queued',
    createdAt: '2026-10-21T10:00:00.000Z',
    updatedAt: '2026-10-21T10:00:00.000Z',
    ...overrides,
  }
}
