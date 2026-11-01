// Composition root for the Fargate worker: the run engine and its pipeline dependencies.
import type { RunStore } from './composition.js'
import { createAnthropicClient } from './lib/anthropic-client.js'
import { systemClock } from './lib/clock.js'
import { newRunId } from './lib/ids.js'
import { createAnthropicLlmRepository } from './repositories/llm-repository.js'
import { createCrawlerSiteFetch } from './crawler-composition.js'
import { createPipelineRegistry } from './services/pipelines.js'
import { createRunEngineService } from './services/run-engine-service.js'
import type { RunEngineService, WorkerEnv } from './types/index.js'

export function createRunEngine(store: RunStore, env: WorkerEnv): RunEngineService {
  const pipelines = createPipelineRegistry({
    siteFetch: createCrawlerSiteFetch(env.FRONTEND_URL),
    llm: createAnthropicLlmRepository(createAnthropicClient(env.ANTHROPIC_API_KEY)),
    models: { smart: env.LLM_MODEL_SMART, fast: env.LLM_MODEL_FAST },
    clock: systemClock,
  })
  return createRunEngineService({ ...store, pipelines, clock: systemClock, newId: newRunId })
}
