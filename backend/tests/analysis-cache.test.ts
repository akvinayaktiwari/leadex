import { CreateTableCommand, DeleteTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDocumentClient } from '../src/lib/dynamo-client.js'
import { createAnalysisCacheTableRepository } from '../src/repositories/analysis-cache-table-repository.js'
import { createRunEventsTableRepository } from '../src/repositories/run-events-table-repository.js'
import { createRunsTableRepository } from '../src/repositories/runs-table-repository.js'
import { ANALYSIS_CACHE_TTL_MS, createAnalysisCacheService } from '../src/services/analysis-cache-service.js'
import { createAnalysisService } from '../src/services/analysis-service.js'
import { createPipelineRegistry } from '../src/services/pipelines.js'
import { createRunEngineService } from '../src/services/run-engine-service.js'
import { RUN_STREAM_DEFAULTS, createRunStreamService } from '../src/services/run-stream-service.js'
import type { RunEvent } from '../src/types/index.js'
import { acmeAnalysisFakes } from './support/analysis-fakes.js'
import { manualClock, memoryQueue, memoryRateLimits } from './support/in-memory-run-store.js'

// DynamoDB Local, as in dynamo-repositories.test.ts.
const ENDPOINT = process.env.DYNAMODB_ENDPOINT
const REGION = 'ap-south-1'
const SUFFIX = `${Date.now()}`
const TABLES = { runs: `test-cache-runs-${SUFFIX}`, events: `test-cache-events-${SUFFIX}`, analyses: `test-cache-analyses-${SUFFIX}` }

process.env.AWS_ACCESS_KEY_ID ??= 'local'
process.env.AWS_SECRET_ACCESS_KEY ??= 'local'

let nextRun = 0
const newId = (): string => `run_${SUFFIX}_${++nextRun}`

const withoutPosition = ({ seq: _seq, ts: _ts, ...body }: RunEvent): Omit<RunEvent, 'seq' | 'ts'> => body

describe.runIf(ENDPOINT)('analysis cache (DynamoDB Local)', () => {
  const raw = new DynamoDBClient({ region: REGION, ...(ENDPOINT ? { endpoint: ENDPOINT } : {}) })
  const client = createDocumentClient(REGION, ENDPOINT)
  const runs = createRunsTableRepository(client, TABLES.runs)
  const events = createRunEventsTableRepository(client, TABLES.events)
  const cache = createAnalysisCacheTableRepository(client, TABLES.analyses)

  beforeAll(async () => {
    const S = 'S' as const
    const N = 'N' as const
    await raw.send(new CreateTableCommand({ TableName: TABLES.runs, BillingMode: 'PAY_PER_REQUEST', AttributeDefinitions: [{ AttributeName: 'runId', AttributeType: S }], KeySchema: [{ AttributeName: 'runId', KeyType: 'HASH' }] }))
    await raw.send(new CreateTableCommand({
      TableName: TABLES.events, BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [{ AttributeName: 'runId', AttributeType: S }, { AttributeName: 'seq', AttributeType: N }],
      KeySchema: [{ AttributeName: 'runId', KeyType: 'HASH' }, { AttributeName: 'seq', KeyType: 'RANGE' }],
    }))
    await raw.send(new CreateTableCommand({
      TableName: TABLES.analyses, BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [{ AttributeName: 'domain', AttributeType: S }, { AttributeName: 'pipelineVersion', AttributeType: S }],
      KeySchema: [{ AttributeName: 'domain', KeyType: 'HASH' }, { AttributeName: 'pipelineVersion', KeyType: 'RANGE' }],
    }))
  })

  afterAll(async () => {
    for (const name of Object.values(TABLES)) await raw.send(new DeleteTableCommand({ TableName: name }))
  })

  function setup() {
    const clock = manualClock()
    const queue = memoryQueue()
    const fakes = acmeAnalysisFakes()
    const pipelines = createPipelineRegistry({ ...fakes, models: { smart: 's', fast: 'f' }, clock })
    const saver = createAnalysisCacheService({ cache, events, clock, pipelineVersion: '1' })
    const worker = createRunEngineService({ runs, events, queue, pipelines, clock, newId, onRunDone: (run) => saver.saveFromRun(run) })
    const api = createRunEngineService({ runs, events, queue, pipelines: {}, clock, newId })
    const analyses = createAnalysisService({ runEngine: api, cache, rateLimits: memoryRateLimits(), clock, pipelineVersion: '1', dailyLimit: 100 })
    const stream = createRunStreamService({ runs, events, clock, sleep: async () => {}, options: RUN_STREAM_DEFAULTS })
    return { clock, queue, fakes, worker, analyses, stream }
  }

  async function streamAll(stream: ReturnType<typeof setup>['stream'], runId: string): Promise<RunEvent[]> {
    const received: RunEvent[] = []
    const end = await stream.stream(runId, 0, { send: async (event) => { received.push(event) }, heartbeat: async () => {}, isClosed: () => false })
    expect(end).toBe('ended')
    return received
  }

  // protects=acceptance criterion 2: the same domain within 30 days returns cached: true and the full replay finishes in under
  // 3 s with 0 crawl, LLM or queue calls; the replayed run streams the same events as the original;
  // fails_when=a repeat request crawls or calls the model again, the replay is incomplete or slow, or events differ;
  // no_claim=fake site and model; real Lambda latency to DynamoDB is not measured here.
  it('replays a completed analysis with no crawl or model calls', async () => {
    const { queue, fakes, worker, analyses, stream } = setup()
    const first = await analyses.start({ url: 'https://acme.com/', ip: '203.0.113.7' })
    expect(first).toMatchObject({ ok: true, cached: false })
    if (!first.ok) return
    await worker.executeRun({ runId: first.runId, type: 'analysis' })
    const original = await streamAll(stream, first.runId)
    const calls = { site: fakes.siteFetch.requested.length, llm: fakes.llm.requests.length, queued: queue.sent.length }

    const startedAt = Date.now()
    const second = await analyses.start({ url: 'acme.com', ip: '203.0.113.7' })
    const replayed = second.ok ? await streamAll(stream, second.runId) : []
    expect(Date.now() - startedAt).toBeLessThan(3_000)

    expect(second).toMatchObject({ ok: true, cached: true, domain: 'acme.com' })
    expect({ site: fakes.siteFetch.requested.length, llm: fakes.llm.requests.length, queued: queue.sent.length }).toEqual(calls)
    expect(replayed.map(withoutPosition)).toEqual(original.map(withoutPosition))
    expect(replayed.map((event) => event.seq)).toEqual(original.map((_, index) => index + 1))
  })

  // protects=a cached analysis older than 30 days, or from another pipeline version, is not replayed;
  // fails_when=stale results are served after the TTL (DynamoDB deletes expired items late) or after a pipeline change;
  // no_claim=n/a.
  it('runs again after 30 days or for a new pipeline version', async () => {
    const { clock, queue, worker, analyses } = setup()
    const first = await analyses.start({ url: 'acme.com', ip: '203.0.113.7' })
    if (!first.ok) throw new Error('start failed')
    await worker.executeRun({ runId: first.runId, type: 'analysis' })
    const newVersion = createAnalysisService({ runEngine: createRunEngineService({ runs, events, queue, pipelines: {}, clock, newId }), cache, rateLimits: memoryRateLimits(), clock, pipelineVersion: '2', dailyLimit: 100 })
    expect(await newVersion.start({ url: 'acme.com', ip: '203.0.113.7' })).toMatchObject({ cached: false })
    clock.advance(ANALYSIS_CACHE_TTL_MS)
    expect(await analyses.start({ url: 'acme.com', ip: '203.0.113.7' })).toMatchObject({ cached: false })
  })
})
