import type {
  Clock,
  RunAccess,
  RunEventSink,
  RunEventsRepository,
  RunStreamEnd,
  RunStreamOptions,
  RunStreamService,
  RunsRepository,
} from '../types/index.js'

export const RUN_STREAM_DEFAULTS: RunStreamOptions = {
  pollMs: 500,
  heartbeatMs: 15_000,
  // Closes before the stream Lambda's 15-minute limit; clients reconnect with Last-Event-ID.
  maxDurationMs: 840_000,
  pageSize: 100,
}

export interface RunStreamDeps {
  runs: RunsRepository
  events: RunEventsRepository
  clock: Clock
  sleep: (ms: number) => Promise<void>
  options: RunStreamOptions
}

interface StreamCursor {
  afterSeq: number
  lastWriteAt: number
  checkedTerminal: boolean
}

async function authorize(deps: RunStreamDeps, runId: string, requesterUserId: string | undefined): Promise<RunAccess> {
  const run = await deps.runs.get(runId)
  if (!run) return { ok: false }
  // Lead builds hold paid data: only the owner may watch them. Analyses are public by design.
  if (run.type === 'lead_build' && (!requesterUserId || run.userId !== requesterUserId)) return { ok: false }
  return { ok: true, run }
}

// Sends one page. Returns 'ended' after an end event, otherwise the number of events sent.
async function sendPage(deps: RunStreamDeps, runId: string, cursor: StreamCursor, sink: RunEventSink): Promise<number | 'ended'> {
  const page = await deps.events.listAfter(runId, cursor.afterSeq, deps.options.pageSize)
  for (const event of page) {
    await sink.send(event)
    cursor.afterSeq = event.seq
    cursor.lastWriteAt = deps.clock.now().getTime()
    if (event.kind === 'end') return 'ended'
  }
  return page.length
}

// A client resuming after the end event would otherwise poll until timeout.
async function isFinishedRun(deps: RunStreamDeps, runId: string, cursor: StreamCursor): Promise<boolean> {
  if (cursor.checkedTerminal) return false
  cursor.checkedTerminal = true
  const run = await deps.runs.get(runId)
  return run?.status === 'done' || run?.status === 'failed'
}

async function stream(deps: RunStreamDeps, runId: string, afterSeq: number, sink: RunEventSink): Promise<RunStreamEnd> {
  const startedAt = deps.clock.now().getTime()
  const cursor: StreamCursor = { afterSeq, lastWriteAt: startedAt, checkedTerminal: false }
  for (;;) {
    if (sink.isClosed()) return 'client_closed'
    const sent = await sendPage(deps, runId, cursor, sink)
    if (sent === 'ended') return 'ended'
    if (sent === deps.options.pageSize) continue
    if (sent === 0 && (await isFinishedRun(deps, runId, cursor))) return 'ended'
    const now = deps.clock.now().getTime()
    if (now - startedAt >= deps.options.maxDurationMs) return 'timeout'
    if (now - cursor.lastWriteAt >= deps.options.heartbeatMs) {
      await sink.heartbeat()
      cursor.lastWriteAt = now
    }
    await deps.sleep(deps.options.pollMs)
  }
}

export function createRunStreamService(deps: RunStreamDeps): RunStreamService {
  return {
    authorize: (runId, requesterUserId) => authorize(deps, runId, requesterUserId),
    stream: (runId, afterSeq, sink) => stream(deps, runId, afterSeq, sink),
  }
}
