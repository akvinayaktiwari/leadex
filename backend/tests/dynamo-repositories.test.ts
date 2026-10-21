import { CreateTableCommand, DeleteTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDocumentClient } from '../src/lib/dynamo-client.js'
import { createRunEventsTableRepository } from '../src/repositories/run-events-table-repository.js'
import { createRunsTableRepository } from '../src/repositories/runs-table-repository.js'
import { resetEnvCacheForTests } from '../src/lib/env.js'
import { createApp } from '../src/routes/index.js'
import { createRunEngineService } from '../src/services/run-engine-service.js'
import { RUN_STREAM_DEFAULTS, createRunStreamService } from '../src/services/run-stream-service.js'
import type { RunEvent } from '../src/types/index.js'
import { manualClock, memoryQueue, sampleRun } from './support/in-memory-run-store.js'

// Runs against DynamoDB Local: `docker run -p 8000:8000 amazon/dynamodb-local:2.6.1`,
// then DYNAMODB_ENDPOINT=http://localhost:8000. CI provides it as a service container.
const ENDPOINT = process.env.DYNAMODB_ENDPOINT
const REGION = 'ap-south-1'
const SUFFIX = `${Date.now()}`
const RUNS_TABLE = `test-runs-${SUFFIX}`
const EVENTS_TABLE = `test-run-events-${SUFFIX}`

// DynamoDB Local accepts any credentials; set dummies so the SDK never looks for real ones.
process.env.AWS_ACCESS_KEY_ID ??= 'local'
process.env.AWS_SECRET_ACCESS_KEY ??= 'local'

function note(seq: number, text = `note ${seq}`): RunEvent {
  return { seq, ts: '2026-10-21T10:00:00.000Z', kind: 'agent_note', text }
}

// protects=CI never silently skips the DynamoDB tests;
// fails_when=the CI job loses its DynamoDB Local service and the suite below is skipped without notice;
// no_claim=local runs without Docker still skip the suite below.
it('has DynamoDB Local in CI', () => {
  if (process.env.CI) expect(ENDPOINT).toBeTruthy()
})

describe.runIf(ENDPOINT)('DynamoDB run repositories', () => {
  const raw = new DynamoDBClient({ region: REGION, ...(ENDPOINT ? { endpoint: ENDPOINT } : {}) })
  const documentClient = createDocumentClient(REGION, ENDPOINT)
  const runs = createRunsTableRepository(documentClient, RUNS_TABLE)
  const events = createRunEventsTableRepository(documentClient, EVENTS_TABLE)

  beforeAll(async () => {
    await raw.send(new CreateTableCommand({
      TableName: RUNS_TABLE,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [{ AttributeName: 'runId', AttributeType: 'S' }],
      KeySchema: [{ AttributeName: 'runId', KeyType: 'HASH' }],
    }))
    await raw.send(new CreateTableCommand({
      TableName: EVENTS_TABLE,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [{ AttributeName: 'runId', AttributeType: 'S' }, { AttributeName: 'seq', AttributeType: 'N' }],
      KeySchema: [{ AttributeName: 'runId', KeyType: 'HASH' }, { AttributeName: 'seq', KeyType: 'RANGE' }],
    }))
  })

  afterAll(async () => {
    await raw.send(new DeleteTableCommand({ TableName: RUNS_TABLE }))
    await raw.send(new DeleteTableCommand({ TableName: EVENTS_TABLE }))
  })

  // protects=run records round-trip, creation is conditional, and status updates set and clear the error;
  // fails_when=a duplicate runId overwrites a run, a stale error survives a later success, or updating a missing run creates it;
  // no_claim=does not test IAM permissions in AWS.
  it('creates, reads and updates runs', async () => {
    await runs.create(sampleRun({ runId: 'run_a', userId: 'user_1' }))
    await expect(runs.create(sampleRun({ runId: 'run_a' }))).rejects.toThrow()
    await runs.setStatus('run_a', 'failed', '2026-10-21T10:01:00.000Z', { code: 'x', message: 'y' })
    expect(await runs.get('run_a')).toMatchObject({ status: 'failed', userId: 'user_1', error: { code: 'x' } })
    await runs.setStatus('run_a', 'done', '2026-10-21T10:02:00.000Z')
    const done = await runs.get('run_a')
    expect(done?.status).toBe('done')
    expect(done?.error).toBeUndefined()
    expect(await runs.get('missing')).toBeUndefined()
    await expect(runs.setStatus('missing', 'done', '2026-10-21T10:02:00.000Z')).rejects.toThrow()
  })

  // protects=events come back in seq order after a given seq, with paging, and payloads round-trip exactly;
  // fails_when=the query returns seq <= after, sorts as strings (10 before 2), or artifact data changes shape;
  // no_claim=does not measure read latency.
  it('lists events after a seq in numeric order', async () => {
    for (const seq of [1, 2, 10, 3]) await events.append('run_e', note(seq))
    const artifact: RunEvent = { seq: 11, ts: '2026-10-21T10:00:00.000Z', kind: 'artifact', step: 'profile', artifact: 'profile', data: { name: 'Ex', tags: ['a', ''], n: 0.5, nested: { empty: '' } } }
    await events.append('run_e', artifact)
    expect((await events.listAfter('run_e', 0, 100)).map((event) => event.seq)).toEqual([1, 2, 3, 10, 11])
    expect((await events.listAfter('run_e', 2, 2)).map((event) => event.seq)).toEqual([3, 10])
    expect((await events.listAfter('run_e', 10, 100))[0]).toEqual(artifact)
    expect(await events.lastSeq('run_e')).toBe(11)
    expect(await events.lastSeq('no_events')).toBe(0)
  })

  // protects=an event seq can never be written twice;
  // fails_when=a second writer silently overwrites an event clients may already have seen;
  // no_claim=does not test two real worker processes racing.
  it('rejects a duplicate seq', async () => {
    await events.append('run_d', note(1, 'first'))
    await expect(events.append('run_d', note(1, 'second'))).rejects.toThrow()
    expect(await events.listAfter('run_d', 0, 10)).toEqual([note(1, 'first')])
  })

  // protects=the engine, DynamoDB repositories, stream service and SSE route work together: a created run is executed
  // and its events are served over HTTP in order, ending with end:done;
  // fails_when=any layer disagrees on keys, seq types or payload shape when backed by real DynamoDB;
  // no_claim=uses an in-memory queue (SQS is a thin repository) and a test pipeline, not real steps.
  it('executes a run and serves its events over SSE', async () => {
    process.env.STAGE = 'dev'
    process.env.AWS_REGION = REGION
    process.env.FRONTEND_URL = 'http://localhost:3000'
    process.env.PIPELINE_VERSION = '1'
    resetEnvCacheForTests()
    const queue = memoryQueue()
    const engine = createRunEngineService({
      runs, events, queue, clock: manualClock(), newId: () => `run_e2e_${SUFFIX}`,
      pipelines: {
        analysis: () => [{ id: 'crawl', label: 'Reading the site', execute: async (context) => {
          await context.emit({ kind: 'agent_note', text: `crawling ${context.run.domain}` })
        } }],
      },
    })
    const run = await engine.createRun({ type: 'analysis', domain: 'example.com' })
    const job = queue.sent[0]
    if (!job) throw new Error('no job enqueued')
    await engine.executeRun(job)

    const runStream = createRunStreamService({ runs, events, clock: manualClock(), sleep: async () => {}, options: RUN_STREAM_DEFAULTS })
    const response = await createApp({ runStream }).request(`/api/runs/${run.runId}/events`, { headers: { 'Last-Event-ID': '1' } })
    const kinds = (await response.text()).split('\n').filter((line) => line.startsWith('event: ')).map((line) => line.slice(7))
    expect(kinds).toEqual(['agent_note', 'step', 'end'])
    expect(await runs.get(run.runId)).toMatchObject({ status: 'done' })
  })
})
