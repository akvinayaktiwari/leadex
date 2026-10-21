import { EventWriteError, PipelineError } from '../lib/errors.js'
import { logError, logInfo } from '../lib/logger.js'
import { captureError } from '../lib/sentry.js'
import type {
  Clock,
  CreateRunInput,
  PipelineRegistry,
  PipelineStep,
  RunErrorInfo,
  RunEventBody,
  RunEventsRepository,
  RunJobMessage,
  RunQueueRepository,
  RunRecord,
  RunEngineService,
  RunsRepository,
} from '../types/index.js'

export interface RunEngineDeps {
  runs: RunsRepository
  events: RunEventsRepository
  queue: RunQueueRepository
  pipelines: PipelineRegistry
  clock: Clock
  newId: () => string
}

interface EventRecorder {
  record(body: RunEventBody): Promise<void>
}

// The worker is the only writer for a run, so seq is allocated in memory after reading the last one.
// The conditional append still rejects a second writer instead of overwriting.
async function createRecorder(deps: RunEngineDeps, runId: string): Promise<EventRecorder> {
  let seq = await deps.events.lastSeq(runId)
  return {
    async record(body: RunEventBody): Promise<void> {
      seq += 1
      try {
        await deps.events.append(runId, { ...body, seq, ts: deps.clock.now().toISOString() })
      } catch (error) {
        throw new EventWriteError(error)
      }
    },
  }
}

function toRunError(step: PipelineStep, error: unknown): RunErrorInfo {
  if (error instanceof PipelineError) return { code: error.code, message: error.message }
  // Internal details stay in logs and Sentry; the client gets a generic message.
  return { code: 'step_failed', message: `${step.label} failed` }
}

async function runStep(deps: RunEngineDeps, run: RunRecord, step: PipelineStep, recorder: EventRecorder): Promise<void> {
  await recorder.record({ kind: 'step', step: step.id, state: 'started', label: step.label })
  const startedAt = deps.clock.now().getTime()
  const elapsed = (): number => deps.clock.now().getTime() - startedAt
  try {
    await step.execute({ run, emit: (emission) => recorder.record(emission) })
  } catch (error) {
    if (error instanceof EventWriteError) throw error
    await recorder.record({ kind: 'step', step: step.id, state: 'failed', label: step.label, durationMs: elapsed() })
    throw error
  }
  await recorder.record({ kind: 'step', step: step.id, state: 'completed', label: step.label, durationMs: elapsed() })
}

// Returns the error that ended the run, or undefined when every step completed.
async function runSteps(deps: RunEngineDeps, run: RunRecord, recorder: EventRecorder): Promise<RunErrorInfo | undefined> {
  const factory = deps.pipelines[run.type]
  if (!factory) return { code: 'pipeline_unavailable', message: `No pipeline is available for ${run.type} runs yet` }
  for (const step of factory(run)) {
    try {
      await runStep(deps, run, step, recorder)
    } catch (error) {
      if (error instanceof EventWriteError) throw error
      logError('pipeline step failed', error, { runId: run.runId, step: step.id })
      captureError(error, { runId: run.runId, step: step.id })
      return toRunError(step, error)
    }
  }
  return undefined
}

async function finishRun(deps: RunEngineDeps, run: RunRecord, recorder: EventRecorder, error: RunErrorInfo | undefined): Promise<void> {
  const status = error ? 'failed' : 'done'
  await recorder.record({ kind: 'end', status, ...(error ? { error } : {}) })
  await deps.runs.setStatus(run.runId, status, deps.clock.now().toISOString(), error)
  logInfo('run finished', { runId: run.runId, type: run.type, status })
}

async function executeRun(deps: RunEngineDeps, job: RunJobMessage): Promise<void> {
  const run = await deps.runs.get(job.runId)
  if (!run) {
    logInfo('run not found, dropping job', { runId: job.runId })
    return
  }
  if (run.status === 'done' || run.status === 'failed') {
    logInfo('run already finished, skipping redelivered job', { runId: run.runId, status: run.status })
    return
  }
  const recorder = await createRecorder(deps, run.runId)
  if (run.status === 'running') {
    await recorder.record({ kind: 'agent_note', text: 'Restarting after an interrupted attempt' })
  }
  await deps.runs.setStatus(run.runId, 'running', deps.clock.now().toISOString())
  const error = await runSteps(deps, run, recorder)
  await finishRun(deps, run, recorder, error)
}

async function createRun(deps: RunEngineDeps, input: CreateRunInput): Promise<RunRecord> {
  const now = deps.clock.now().toISOString()
  const run: RunRecord = { runId: deps.newId(), status: 'queued', createdAt: now, updatedAt: now, ...input }
  await deps.runs.create(run)
  try {
    await deps.queue.send({ runId: run.runId, type: run.type })
  } catch (error) {
    // Don't leave a run stuck in "queued" that no worker will ever pick up.
    await deps.runs.setStatus(run.runId, 'failed', deps.clock.now().toISOString(), {
      code: 'enqueue_failed',
      message: 'The run could not be started',
    })
    throw error
  }
  return run
}

export function createRunEngineService(deps: RunEngineDeps): RunEngineService {
  return {
    createRun: (input) => createRun(deps, input),
    executeRun: (job) => executeRun(deps, job),
  }
}
