// Composition root for the HTTP Lambdas: builds SDK clients and wires repositories into services.
// The worker's pipeline wiring lives in worker-composition.ts so the API bundles don't ship the crawler or LLM SDK.
import { sleep, systemClock } from './lib/clock.js'
import { newRunId } from './lib/ids.js'
import { createDocumentClient } from './lib/dynamo-client.js'
import { getAnalysesEnv } from './lib/env.js'
import { createSqsClient } from './lib/sqs-client.js'
import { createAnalysisCacheTableRepository } from './repositories/analysis-cache-table-repository.js'
import { createSecretsRepository } from './repositories/secrets-repository.js'
import { createTurnstileRepository } from './repositories/turnstile-repository.js'
import { createRateLimitsTableRepository } from './repositories/rate-limits-table-repository.js'
import { createRunEventsTableRepository } from './repositories/run-events-table-repository.js'
import { createRunQueueRepository } from './repositories/run-queue-repository.js'
import { createRunsTableRepository } from './repositories/runs-table-repository.js'
import { DISABLED_ANALYSIS_SERVICE, createAnalysisService } from './services/analysis-service.js'
import { createRunEngineService } from './services/run-engine-service.js'
import { RUN_STREAM_DEFAULTS, createRunStreamService } from './services/run-stream-service.js'
import type {
  AnalysesEnv,
  AnalysisCacheRepository,
  AnalysisService,
  ApiEnv,
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
  analysisCache: AnalysisCacheRepository
}

export function createRunStore(env: RunStoreEnv): RunStore {
  const documentClient = createDocumentClient(env.AWS_REGION, env.DYNAMODB_ENDPOINT)
  return {
    runs: createRunsTableRepository(documentClient, env.TABLE_RUNS),
    events: createRunEventsTableRepository(documentClient, env.TABLE_RUN_EVENTS),
    queue: createRunQueueRepository(createSqsClient(env.AWS_REGION, env.SQS_ENDPOINT), env.SQS_RUNS_QUEUE_URL),
    analysisCache: createAnalysisCacheTableRepository(documentClient, env.TABLE_ANALYSES),
  }
}

// The API only creates runs (the worker executes them), so the run engine here has no pipelines.
// In AWS the Turnstile secret comes from the stage's app secret, never from the Lambda's plain environment.
async function turnstileSecret(env: AnalysesEnv, region: string): Promise<string> {
  if (env.TURNSTILE_SECRET) return env.TURNSTILE_SECRET
  if (!env.APP_SECRET_ID) throw new Error('TURNSTILE_SECRET or APP_SECRET_ID is required')
  return createSecretsRepository(region).readField(env.APP_SECRET_ID, 'TURNSTILE_SECRET')
}

// Analyses are built only when enabled; their settings (rate limits, Turnstile) are read only then.
export async function createAnalyses(store: RunStore, apiEnv: ApiEnv, storeEnv: RunStoreEnv): Promise<AnalysisService> {
  if (!apiEnv.PUBLIC_ANALYSES_ENABLED) return DISABLED_ANALYSIS_SERVICE
  const env = getAnalysesEnv()
  const documentClient = createDocumentClient(storeEnv.AWS_REGION, storeEnv.DYNAMODB_ENDPOINT)
  return createAnalysisService({
    runEngine: createRunEngineService({ ...store, pipelines: {}, clock: systemClock, newId: newRunId }),
    cache: store.analysisCache,
    rateLimits: createRateLimitsTableRepository(documentClient, env.TABLE_RATE_LIMITS),
    turnstile: createTurnstileRepository(env.TURNSTILE_VERIFY_URL, await turnstileSecret(env, storeEnv.AWS_REGION)),
    clock: systemClock,
    pipelineVersion: apiEnv.PIPELINE_VERSION,
    dailyLimit: env.ANONYMOUS_ANALYSES_PER_DAY,
  })
}

export function createApiServices(store: RunStore, analyses: AnalysisService): ApiServices {
  return {
    runStream: createRunStreamService({ ...store, clock: systemClock, sleep, options: RUN_STREAM_DEFAULTS }),
    analyses,
  }
}
