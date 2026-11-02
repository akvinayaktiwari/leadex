import { beforeEach, describe, expect, it } from 'vitest'
import { getApiEnv, resetEnvCacheForTests } from '../src/lib/env.js'
import { createApp } from '../src/routes/index.js'
import { createAnalysisService } from '../src/services/analysis-service.js'
import { createRunEngineService } from '../src/services/run-engine-service.js'
import type { ApiServices } from '../src/types/index.js'
import { manualClock, memoryEvents, memoryQueue, memoryRuns } from './support/in-memory-run-store.js'

function setup(enabled: boolean) {
  const runs = memoryRuns()
  const queue = memoryQueue()
  const runEngine = createRunEngineService({ runs, events: memoryEvents(), queue, pipelines: {}, clock: manualClock(), newId: () => 'run_new' })
  const services: ApiServices = {
    runStream: { authorize: () => Promise.reject(new Error('not used')), stream: () => Promise.reject(new Error('not used')) },
    analyses: createAnalysisService({ runEngine, enabled }),
  }
  return { app: createApp(services), runs, queue }
}

const post = (app: ReturnType<typeof createApp>, body: unknown) =>
  app.request('/api/analyses', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' }, body: JSON.stringify(body) })

describe('POST /api/analyses', () => {
  beforeEach(() => {
    process.env.STAGE = 'dev'
    process.env.AWS_REGION = 'ap-south-1'
    process.env.FRONTEND_URL = 'http://localhost:3000'
    process.env.PIPELINE_VERSION = '1'
    resetEnvCacheForTests()
  })

  // protects=a pasted URL is normalized to its domain, an analysis run is created and queued, and the client gets 202 with the
  // run id and domain (CORS allowed for the frontend);
  // fails_when=the raw URL is stored as the domain, no job reaches the worker, or the browser is blocked by CORS;
  // no_claim=in-memory run store and queue; DynamoDB/SQS are covered by their own tests.
  it('starts an analysis for a pasted URL', async () => {
    const { app, runs, queue } = setup(true)
    const response = await post(app, { url: 'https://WWW.Acme.com/pricing?x=1' })
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ runId: 'run_new', domain: 'acme.com' })
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:3000')
    expect((await runs.get('run_new'))?.type).toBe('analysis')
    expect(queue.sent).toEqual([{ runId: 'run_new', type: 'analysis' }])
  })

  // protects=bad input is refused with a code the UI can show, and nothing is queued;
  // fails_when=localhost, an IP or garbage starts a paid run, or a missing body crashes the route (500);
  // no_claim=n/a.
  it('refuses invalid and non-public addresses', async () => {
    const { app, queue } = setup(true)
    expect((await post(app, { url: 'not a url' })).status).toBe(400)
    const local = await post(app, { url: 'http://localhost:8080' })
    expect(local.status).toBe(400)
    expect(await local.json()).toMatchObject({ error: { code: 'unsupported_host' } })
    expect((await post(app, { nope: true })).status).toBe(400)
    expect((await app.request('/api/analyses', { method: 'POST', body: '{broken' })).status).toBe(400)
    expect(queue.sent).toEqual([])
  })

  // protects=analyses are off unless PUBLIC_ANALYSES_ENABLED is true, so a deployed API cannot be used to run up model costs
  // before rate limits and Turnstile exist (#7);
  // fails_when=a disabled API still queues runs;
  // no_claim=n/a.
  it('is off by default', async () => {
    const { app, queue } = setup(false)
    const response = await post(app, { url: 'acme.com' })
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: { code: 'analyses_disabled' } })
    expect(queue.sent).toEqual([])
    const base = { STAGE: 'dev', AWS_REGION: 'ap-south-1', FRONTEND_URL: 'http://localhost:3000', PIPELINE_VERSION: '1' }
    resetEnvCacheForTests()
    expect(getApiEnv(base).PUBLIC_ANALYSES_ENABLED).toBe(false)
    resetEnvCacheForTests()
    expect(getApiEnv({ ...base, PUBLIC_ANALYSES_ENABLED: 'true' }).PUBLIC_ANALYSES_ENABLED).toBe(true)
    resetEnvCacheForTests()
  })
})
