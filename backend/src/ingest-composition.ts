// Composition root for the scheduled ingest task: the Leadex Data service and the import jobs.
import type { ClickHouseClient } from '@clickhouse/client'
import { createCrawlerSiteFetch } from './crawler-composition.js'
import { createAnthropicClient } from './lib/anthropic-client.js'
import { createClickhouseClient } from './lib/clickhouse-client.js'
import { systemClock } from './lib/clock.js'
import { createCommonCrawlRepository } from './repositories/common-crawl-repository.js'
import { createCrawlStatusRepository } from './repositories/crawl-status-repository.js'
import { createDomainCandidatesRepository } from './repositories/domain-candidates-repository.js'
import { createLeadDataRepository } from './repositories/lead-data-repository.js'
import { createAnthropicLlmRepository } from './repositories/llm-repository.js'
import { profileBatch, type CompanyProfilerDeps, type ProfileBatchOptions } from './services/company-profiler-service.js'
import { importDomainRanks } from './services/domain-import-service.js'
import { createLeadDataService } from './services/lead-data-service.js'
import type { IngestEnv, IngestJob, LeadDataService, LlmPrices } from './types/index.js'

const DOWNLOAD_USER_AGENT = 'LeadexBot/1.0 (open-data import)'
const DOMAIN_BATCH_SIZE = 10_000
const PROFILE_MAX_ATTEMPTS = 3
const PROFILE_RETRY_AFTER_DAYS = 7
const PROFILE_REFRESH_AFTER_DAYS = 90

export interface IngestRuntime {
  leadData: LeadDataService
  jobs: IngestJob[]
  close(): Promise<void>
}

function domainRanksJob(env: IngestEnv, client: ClickHouseClient): IngestJob[] {
  const url = env.CC_DOMAIN_RANKS_URL
  if (!url) return []
  const deps = { source: createCommonCrawlRepository(DOWNLOAD_USER_AGENT), candidates: createDomainCandidatesRepository(client), clock: systemClock }
  return [{
    name: 'common_crawl_domains',
    run: () => importDomainRanks(deps, { url, maxDomains: env.INGEST_CC_MAX_DOMAINS, batchSize: DOMAIN_BATCH_SIZE }),
  }]
}

function pricesFrom(env: IngestEnv): LlmPrices | undefined {
  const input = env.LLM_FAST_INPUT_USD_PER_MTOK
  const output = env.LLM_FAST_OUTPUT_USD_PER_MTOK
  return input === undefined || output === undefined ? undefined : { inputUsdPerMillion: input, outputUsdPerMillion: output }
}

export function profileOptions(env: IngestEnv, limit: number = env.INGEST_PROFILE_MAX_PER_RUN): ProfileBatchOptions {
  return { limit, concurrency: env.INGEST_PROFILE_CONCURRENCY, maxAttempts: PROFILE_MAX_ATTEMPTS, retryAfterDays: PROFILE_RETRY_AFTER_DAYS, refreshAfterDays: PROFILE_REFRESH_AFTER_DAYS }
}

// Undefined when the profiler is not configured (env.ts already requires all three when INGEST_PROFILE_MAX_PER_RUN > 0).
export function createProfilerDeps(env: IngestEnv, client: ClickHouseClient, leadData: LeadDataService): CompanyProfilerDeps | undefined {
  const { ANTHROPIC_API_KEY: apiKey, LLM_MODEL_FAST: model, FRONTEND_URL: frontendUrl } = env
  if (!apiKey || !model || !frontendUrl) return undefined
  return {
    statuses: createCrawlStatusRepository(client), leadData, siteFetch: createCrawlerSiteFetch(frontendUrl),
    llm: createAnthropicLlmRepository(createAnthropicClient(apiKey)), model, clock: systemClock, prices: pricesFrom(env),
  }
}

function profilerJob(env: IngestEnv, deps: CompanyProfilerDeps | undefined): IngestJob[] {
  if (env.INGEST_PROFILE_MAX_PER_RUN === 0 || !deps) return []
  return [{
    name: 'company_profiler',
    run: async () => {
      const summary = await profileBatch(deps, profileOptions(env))
      const skipped = Object.values(summary.skipped).reduce((sum, count) => sum + count, 0)
      return { written: summary.profiled, skipped }
    },
  }]
}

// Order matters: new domains are imported before the profiler picks its batch.
// GLEIF (#22 part 3) and the people sources (#23) register here as they land.
export function createIngestRuntime(env: IngestEnv): IngestRuntime {
  const client: ClickHouseClient = createClickhouseClient(env)
  const leadData = createLeadDataService({ repository: createLeadDataRepository(client), clock: systemClock })
  const jobs = [...domainRanksJob(env, client), ...profilerJob(env, createProfilerDeps(env, client, leadData))]
  return { leadData, jobs, close: () => client.close() }
}
