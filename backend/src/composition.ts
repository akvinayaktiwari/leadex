// Composition root for the HTTP Lambdas: builds SDK clients and wires repositories into services.
// The worker's pipeline wiring lives in worker-composition.ts so the API bundles don't ship the crawler or LLM SDK.
import { sleep, systemClock } from './lib/clock.js'
import { createDocumentClient } from './lib/dynamo-client.js'
import { createSqsClient } from './lib/sqs-client.js'
import { createRunEventsTableRepository } from './repositories/run-events-table-repository.js'
import { createRunQueueRepository } from './repositories/run-queue-repository.js'
import { createRunsTableRepository } from './repositories/runs-table-repository.js'
import { RUN_STREAM_DEFAULTS, createRunStreamService } from './services/run-stream-service.js'
import type {
  ApiServices,
  RunEventsRepository,
  RunQueueRepository,
  RunStoreEnv,
  RunsRepository,
} from './types/index.js'

export interface RunStore {
  runs: RunsRepository
  events: RunEventsRepository
  queue: RunQueueRepository
}

export function createRunStore(env: RunStoreEnv): RunStore {
  const documentClient = createDocumentClient(env.AWS_REGION, env.DYNAMODB_ENDPOINT)
  return {
    runs: createRunsTableRepository(documentClient, env.TABLE_RUNS),
    events: createRunEventsTableRepository(documentClient, env.TABLE_RUN_EVENTS),
    queue: createRunQueueRepository(createSqsClient(env.AWS_REGION), env.SQS_RUNS_QUEUE_URL),
  }
}

export function createApiServices(store: RunStore): ApiServices {
  return {
    runStream: createRunStreamService({ ...store, clock: systemClock, sleep, options: RUN_STREAM_DEFAULTS }),
  }
}
