// Composition root for the Fargate worker: the run engine and its pipeline dependencies.
import type { RunStore } from './composition.js'
import { createAnthropicClient } from './lib/anthropic-client.js'
import { systemClock } from './lib/clock.js'
import { newRunId } from './lib/ids.js'
import { createAnthropicLlmRepository } from './repositories/llm-repository.js'
import { createCrawlerSiteFetch } from './crawler-composition.js'
import { createAnalysisCacheService } from './services/analysis-cache-service.js'
import { createPipelineRegistry } from './services/pipelines.js'
import { createRunEngineService } from './services/run-engine-service.js'
import { createClickhouseClient } from './lib/clickhouse-client.js'
import { createLeadDataRepository } from './repositories/lead-data-repository.js'
import { createLeadDataService } from './services/lead-data-service.js'
import type { LeadDataService, RunEngineService, WorkerEnv } from './types/index.js'

// Leadex Data for lead builds, when the worker has a ClickHouse connection (the env schema requires all four or none).
function leadDataFrom(env: WorkerEnv): LeadDataService | undefined {
  const { CLICKHOUSE_URL, CLICKHOUSE_USER, CLICKHOUSE_PASSWORD, CLICKHOUSE_DATABASE } = env
  if (!CLICKHOUSE_URL || !CLICKHOUSE_USER || !CLICKHOUSE_PASSWORD || !CLICKHOUSE_DATABASE) return undefined
  const client = createClickhouseClient({ CLICKHOUSE_URL, CLICKHOUSE_USER, CLICKHOUSE_PASSWORD, CLICKHOUSE_DATABASE })
  return createLeadDataService({ repository: createLeadDataRepository(client), clock: systemClock })
}

export function createRunEngine(store: RunStore, env: WorkerEnv): RunEngineService {
  const pipelines = createPipelineRegistry({
    siteFetch: createCrawlerSiteFetch(env.FRONTEND_URL),
    llm: createAnthropicLlmRepository(createAnthropicClient(env.ANTHROPIC_API_KEY)),
    models: { smart: env.LLM_MODEL_SMART, fast: env.LLM_MODEL_FAST },
    clock: systemClock,
    leadData: leadDataFrom(env),
  })
  const cache = createAnalysisCacheService({ cache: store.analysisCache, events: store.events, clock: systemClock, pipelineVersion: env.PIPELINE_VERSION })
  return createRunEngineService({ ...store, pipelines, clock: systemClock, newId: newRunId, onRunDone: (run) => cache.saveFromRun(run) })
}
