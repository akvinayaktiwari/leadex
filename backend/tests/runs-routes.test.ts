import { beforeEach, describe, expect, it } from 'vitest'
import { resetEnvCacheForTests } from '../src/lib/env.js'
import { createApp } from '../src/routes/index.js'
import { RUN_STREAM_DEFAULTS, createRunStreamService } from '../src/services/run-stream-service.js'
import type { ApiErrorBody, ApiServices, RunEvent } from '../src/types/index.js'
import { manualClock, memoryEvents, memoryRuns, sampleRun } from './support/in-memory-run-store.js'

const TS = '2026-10-21T10:00:00.000Z'
const EVENTS: RunEvent[] = [
  { seq: 1, ts: TS, kind: 'step', step: 'crawl', state: 'started', label: 'Reading the site' },
  { seq: 2, ts: TS, kind: 'step', step: 'crawl', state: 'completed', label: 'Reading the site', durationMs: 900 },
  { seq: 3, ts: TS, kind: 'end', status: 'done' },
]

async function services(): Promise<ApiServices> {
  const runs = memoryRuns()
  const events = memoryEvents()
  await runs.create(sampleRun({ status: 'done' }))
  await runs.create(sampleRun({ runId: 'run_lb', type: 'lead_build', userId: 'user_a' }))
  for (const event of EVENTS) await events.append('run_1', event)
  const runStream = createRunStreamService({ runs, events, clock: manualClock(), sleep: async () => {}, options: RUN_STREAM_DEFAULTS })
  return { runStream }
}

function eventIds(body: string): string[] {
  return body.split('\n').filter((line) => line.startsWith('id: ')).map((line) => line.slice(4))
}

describe('GET /api/runs/:runId/events', () => {
  beforeEach(() => {
    process.env.STAGE = 'dev'
    process.env.AWS_REGION = 'ap-south-1'
    process.env.FRONTEND_URL = 'http://localhost:3000'
    process.env.PIPELINE_VERSION = '1'
    resetEnvCacheForTests()
  })

  // protects=the route streams text/event-stream frames for every event and closes after end;
  // fails_when=wrong content type, missing frames, or the response never completes;
  // no_claim=does not run inside the Lambda RESPONSE_STREAM runtime.
  it('streams all events as SSE', async () => {
    const response = await createApp(await services()).request('/api/runs/run_1/events')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const body = await response.text()
    expect(eventIds(body)).toEqual(['1', '2', '3'])
    expect(body).toContain('event: end')
  })

  // protects=the Last-Event-ID header and the ?after= fallback both resume after the given seq;
  // fails_when=the header is ignored and the client gets duplicates, or ?after= is ignored on manual reconnects;
  // no_claim=does not test browser EventSource reconnection timing.
  it('resumes from Last-Event-ID or ?after=', async () => {
    const app = createApp(await services())
    const byHeader = await app.request('/api/runs/run_1/events', { headers: { 'Last-Event-ID': '1' } })
    expect(eventIds(await byHeader.text())).toEqual(['2', '3'])
    const byQuery = await app.request('/api/runs/run_1/events?after=2')
    expect(eventIds(await byQuery.text())).toEqual(['3'])
  })

  // protects=unknown runs and other users' lead builds return a JSON 404, not a stream;
  // fails_when=a stream opens for a run the requester may not see, or the error is not JSON;
  // no_claim=does not test authenticated owners (no auth until #8).
  it('returns 404 for unknown or private runs', async () => {
    const app = createApp(await services())
    for (const path of ['/api/runs/nope/events', '/api/runs/run_lb/events']) {
      const response = await app.request(path)
      expect(response.status).toBe(404)
      expect(((await response.json()) as ApiErrorBody).error.code).toBe('not_found')
    }
  })
})
