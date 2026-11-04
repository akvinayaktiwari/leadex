import { describe, expect, it } from 'vitest'
import { PipelineError } from '../src/lib/errors.js'
import { createRunEngineService, type RunEngineDeps } from '../src/services/run-engine-service.js'
import type { PipelineRegistry, PipelineStep, RunEvent } from '../src/types/index.js'
import { manualClock, memoryEvents, memoryQueue, memoryRuns, sampleRun } from './support/in-memory-run-store.js'

function setup(pipelines: PipelineRegistry) {
  const deps: RunEngineDeps = {
    runs: memoryRuns(),
    events: memoryEvents(),
    queue: memoryQueue(),
    pipelines,
    clock: manualClock(),
    newId: () => 'run_new',
  }
  return { deps, engine: createRunEngineService(deps), runs: deps.runs as ReturnType<typeof memoryRuns>, events: deps.events as ReturnType<typeof memoryEvents>, queue: deps.queue as ReturnType<typeof memoryQueue> }
}

function step(id: PipelineStep['id'], label: string, execute: PipelineStep['execute'] = async () => {}): PipelineStep {
  return { id, label, execute }
}

const summary = (events: RunEvent[]): string[] =>
  events.map((event) => (event.kind === 'step' ? `${event.step}:${event.state}` : event.kind === 'end' ? `end:${event.status}` : event.kind))

describe('run engine', () => {
  // protects=a run executes its steps in order, emitting started/completed with durations, artifacts in between, then end:done;
  // fails_when=steps run out of order, seq is not 1..n without gaps, durations are missing, or status is not done;
  // no_claim=does not test real pipeline steps (none are registered until #4).
  it('runs steps in order and records contiguous events', async () => {
    const { deps, engine, runs, events } = setup({
      analysis: () => [
        step('crawl', 'Reading the site', async (context) => {
          ;(deps.clock as ReturnType<typeof manualClock>).advance(1200)
          await context.emit({ kind: 'agent_note', text: 'Found 4 pages' })
        }),
        step('profile', 'Summarizing the product', async (context) => {
          await context.emit({ kind: 'artifact', step: 'profile', artifact: 'profile', data: { name: 'Example' } })
        }),
      ],
    })
    await runs.create(sampleRun())
    await engine.executeRun({ runId: 'run_1', type: 'analysis' })

    const recorded = events.all('run_1')
    expect(summary(recorded)).toEqual(['crawl:started', 'agent_note', 'crawl:completed', 'profile:started', 'artifact', 'profile:completed', 'end:done'])
    expect(recorded.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6, 7])
    const crawlDone = recorded[2]
    expect(crawlDone?.kind === 'step' && crawlDone.durationMs).toBe(1200)
    expect((await runs.get('run_1'))?.status).toBe('done')
  })

  // protects=a failing step ends the run as failed with the step's code, later steps never run, and the job is not retried;
  // fails_when=the run hangs in running, later steps still execute, or executeRun throws (which would make SQS retry);
  // no_claim=does not test which failures a real step classifies as PipelineError.
  it('ends the run as failed when a step fails', async () => {
    let laterStepRan = false
    const { engine, runs, events } = setup({
      analysis: () => [
        step('crawl', 'Reading the site', async () => {
          throw new PipelineError('site_unreachable', 'We could not reach example.com')
        }),
        step('profile', 'Summarizing the product', async () => {
          laterStepRan = true
        }),
      ],
    })
    await runs.create(sampleRun())
    await expect(engine.executeRun({ runId: 'run_1', type: 'analysis' })).resolves.toBeUndefined()

    expect(laterStepRan).toBe(false)
    expect(summary(events.all('run_1'))).toEqual(['crawl:started', 'crawl:failed', 'end:failed'])
    expect(events.all('run_1').at(-1)).toMatchObject({ kind: 'end', error: { code: 'site_unreachable' } })
    expect(await runs.get('run_1')).toMatchObject({ status: 'failed', error: { code: 'site_unreachable' } })
  })

  // protects=unexpected errors reach the client as a generic message, never the internal error text;
  // fails_when=a vendor error message or stack leaks into the public event stream;
  // no_claim=does not check what Sentry receives.
  it('hides internal error details from the event stream', async () => {
    const { engine, runs, events } = setup({
      analysis: () => [
        step('profile', 'Summarizing the product', async () => {
          throw new Error('anthropic 529: overloaded, key sk-live-123')
        }),
      ],
    })
    await runs.create(sampleRun())
    await engine.executeRun({ runId: 'run_1', type: 'analysis' })
    const end = events.all('run_1').at(-1)
    expect(end).toMatchObject({ kind: 'end', error: { code: 'step_failed', message: 'Summarizing the product failed' } })
    expect(JSON.stringify(events.all('run_1'))).not.toContain('sk-live')
  })

  // protects=a redelivered job for a finished run does nothing;
  // fails_when=SQS redelivery re-runs a completed pipeline (double spend later, duplicate events now);
  // no_claim=does not test concurrent workers on the same run.
  it('skips a redelivered job for a finished run', async () => {
    let calls = 0
    const { engine, runs, events } = setup({ analysis: () => [step('crawl', 'Reading the site', async () => void calls++)] })
    await runs.create(sampleRun({ status: 'done' }))
    await engine.executeRun({ runId: 'run_1', type: 'analysis' })
    expect(calls).toBe(0)
    expect(events.all('run_1')).toEqual([])
  })

  // protects=an interrupted run restarts with seq continuing after the last stored event;
  // fails_when=the retry reuses seq 1 (conditional write fails forever) or leaves gaps the SSE client would miss;
  // no_claim=does not make steps idempotent; each step must handle re-execution itself.
  it('continues seq when retrying an interrupted run', async () => {
    const { engine, runs, events } = setup({ analysis: () => [step('crawl', 'Reading the site')] })
    await runs.create(sampleRun({ status: 'running' }))
    await events.append('run_1', { seq: 1, ts: '2026-10-21T10:00:00.000Z', kind: 'step', step: 'crawl', state: 'started', label: 'Reading the site' })
    await engine.executeRun({ runId: 'run_1', type: 'analysis' })
    const recorded = events.all('run_1')
    expect(recorded.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5])
    expect(summary(recorded)).toEqual(['crawl:started', 'agent_note', 'crawl:started', 'crawl:completed', 'end:done'])
  })

  // protects=a run type with no registered pipeline fails fast with pipeline_unavailable;
  // fails_when=the run stays queued/running forever and the client waits until timeout;
  // no_claim=nothing about which pipelines exist.
  it('fails a run whose type has no pipeline', async () => {
    const { engine, runs, events } = setup({})
    await runs.create(sampleRun({ type: 'lead_build' }))
    await engine.executeRun({ runId: 'run_1', type: 'lead_build' })
    expect(events.all('run_1').at(-1)).toMatchObject({ kind: 'end', status: 'failed', error: { code: 'pipeline_unavailable' } })
  })

  // protects=storage failures are not swallowed as step failures, so SQS retries the job;
  // fails_when=a DynamoDB outage marks the run failed for the user instead of retrying;
  // no_claim=does not test the DLQ after 2 receives (infra test covers config).
  it('rethrows event write failures so the job is retried', async () => {
    const { engine, runs, events } = setup({
      analysis: () => [
        step('crawl', 'Reading the site', async (context) => {
          events.failNextAppend = true
          await context.emit({ kind: 'agent_note', text: 'Found 4 pages' })
        }),
      ],
    })
    await runs.create(sampleRun())
    await expect(engine.executeRun({ runId: 'run_1', type: 'analysis' })).rejects.toThrow(/Could not write run event/)
    expect((await runs.get('run_1'))?.status).toBe('running')
  })

  // protects=createRun stores a queued run and enqueues exactly one job for it;
  // fails_when=the job is enqueued before the run exists, or carries the wrong id/type;
  // no_claim=does not test the API route that calls it (#4).
  it('creates a queued run and enqueues it', async () => {
    const { engine, runs, queue } = setup({})
    const run = await engine.createRun({ type: 'analysis', domain: 'example.com' })
    expect(run).toMatchObject({ runId: 'run_new', status: 'queued', domain: 'example.com' })
    expect(await runs.get('run_new')).toMatchObject({ status: 'queued' })
    expect(queue.sent).toEqual([{ runId: 'run_new', type: 'analysis' }])
  })

  // protects=an enqueue failure marks the run failed and surfaces the error;
  // fails_when=a run is left queued forever with no job, or the caller gets a 202 for a run that will never start;
  // no_claim=does not retry the enqueue.
  it('marks the run failed when enqueue fails', async () => {
    const { engine, runs, queue } = setup({})
    queue.failSend = true
    await expect(engine.createRun({ type: 'analysis', domain: 'example.com' })).rejects.toThrow(/SQS unavailable/)
    expect(await runs.get('run_new')).toMatchObject({ status: 'failed', error: { code: 'enqueue_failed' } })
  })

  // protects=the after-run hook (cache save) runs once for a successful run, never for a failed one, and its failure does not
  // fail a run that already finished;
  // fails_when=failed analyses are cached, or a cache write error turns a done run into a retried job;
  // no_claim=n/a.
  it('calls the after-run hook only for successful runs', async () => {
    const done: string[] = []
    const ok = setup({ analysis: () => [step('crawl', 'Reading')] })
    ok.deps.onRunDone = async (run) => { done.push(run.runId) }
    await ok.runs.create(sampleRun())
    await createRunEngineService(ok.deps).executeRun({ runId: 'run_1', type: 'analysis' })
    expect(done).toEqual(['run_1'])

    const failing = setup({ analysis: () => [step('crawl', 'Reading', async () => { throw new Error('boom') })] })
    failing.deps.onRunDone = async (run) => { done.push(run.runId) }
    await failing.runs.create(sampleRun({ runId: 'run_2' }))
    await createRunEngineService(failing.deps).executeRun({ runId: 'run_2', type: 'analysis' })
    expect(done).toEqual(['run_1'])

    const broken = setup({ analysis: () => [step('crawl', 'Reading')] })
    broken.deps.onRunDone = async () => { throw new Error('cache down') }
    await broken.runs.create(sampleRun({ runId: 'run_3' }))
    await createRunEngineService(broken.deps).executeRun({ runId: 'run_3', type: 'analysis' })
    expect(await broken.runs.get('run_3')).toMatchObject({ status: 'done' })
  })

  // protects=a replayed run gets the saved events with new seq 1..n and timestamps, then end:done, without a queue job; a write
  // failure mid-replay marks the run failed;
  // fails_when=a replay enqueues work, keeps the old seq/ts, lacks the end event, or leaves a half-written run "running";
  // no_claim=n/a.
  it('replays saved events into a finished run', async () => {
    const { engine, runs, events, queue } = setup({})
    const saved: RunEvent[] = [
      { seq: 7, ts: '2026-01-01T00:00:00.000Z', kind: 'step', step: 'crawl', state: 'started', label: 'Reading' },
      { seq: 9, ts: '2026-01-01T00:00:01.000Z', kind: 'agent_note', text: 'Read 4 pages' },
    ]
    const run = await engine.createReplayedRun({ type: 'analysis', domain: 'example.com' }, saved)
    expect(run.status).toBe('done')
    expect(events.all('run_new').map((event) => [event.seq, event.ts, event.kind])).toEqual([
      [1, '2026-10-21T10:00:00.000Z', 'step'], [2, '2026-10-21T10:00:00.000Z', 'agent_note'], [3, '2026-10-21T10:00:00.000Z', 'end'],
    ])
    expect(await runs.get('run_new')).toMatchObject({ status: 'done' })
    expect(queue.sent).toEqual([])

    const failing = setup({})
    failing.events.failNextAppend = true
    await expect(failing.engine.createReplayedRun({ type: 'analysis', domain: 'example.com' }, saved)).rejects.toThrow()
    expect(await failing.runs.get('run_new')).toMatchObject({ status: 'failed', error: { code: 'replay_failed' } })
  })
})
