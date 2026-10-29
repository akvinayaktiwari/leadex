// Composition root for the Fargate worker: the run engine and its pipeline dependencies.
import type { RunStore } from './composition.js'
import { isPublicAddress } from './lib/address-policy.js'
import { createAnthropicClient } from './lib/anthropic-client.js'
import { systemClock } from './lib/clock.js'
import { newRunId } from './lib/ids.js'
import { createAnthropicLlmRepository } from './repositories/llm-repository.js'
import { createSiteFetchRepository } from './repositories/site-fetch-repository.js'
import { createPipelineRegistry } from './services/pipelines.js'
import { createRunEngineService } from './services/run-engine-service.js'
import type { RunEngineService, WorkerEnv } from './types/index.js'

const MAX_PAGE_BYTES = 3_000_000
const MAX_REDIRECTS = 4

function crawlerUserAgent(env: WorkerEnv): string {
  return `LeadexBot/1.0 (+${new URL('/bot', env.FRONTEND_URL).href})`
}

export function createRunEngine(store: RunStore, env: WorkerEnv): RunEngineService {
  const pipelines = createPipelineRegistry({
    siteFetch: createSiteFetchRepository({ userAgent: crawlerUserAgent(env), maxBytes: MAX_PAGE_BYTES, maxRedirects: MAX_REDIRECTS, isAllowedAddress: isPublicAddress }),
    llm: createAnthropicLlmRepository(createAnthropicClient(env.ANTHROPIC_API_KEY)),
    models: { smart: env.LLM_MODEL_SMART, fast: env.LLM_MODEL_FAST },
    clock: systemClock,
  })
  return createRunEngineService({ ...store, pipelines, clock: systemClock, newId: newRunId })
}
