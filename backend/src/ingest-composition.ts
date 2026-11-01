// Composition root for the scheduled ingest task: the Leadex Data service and the import jobs.
import type { ClickHouseClient } from '@clickhouse/client'
import { createCrawlerSiteFetch } from './crawler-composition.js'
import { createAnthropicClient } from './lib/anthropic-client.js'
import { createClickhouseClient } from './lib/clickhouse-client.js'
import { systemClock } from './lib/clock.js'
import { createCommonCrawlRepository } from './repositories/common-crawl-repository.js'
import { createCrawlStatusRepository } from './repositories/crawl-status-repository.js'
import { createDomainCandidatesRepository } from './repositories/domain-candidates-repository.js'
import { createGleifRepository } from './repositories/gleif-repository.js'
import { createLeadDataRepository } from './repositories/lead-data-repository.js'
import { createLegalEntitiesRepository } from './repositories/legal-entities-repository.js'
import { createPeopleExtractionRepository } from './repositories/people-extraction-repository.js'
import { createAnthropicLlmRepository } from './repositories/llm-repository.js'
import { profileBatch, type CompanyProfilerDeps, type ProfileBatchOptions } from './services/company-profiler-service.js'
import { importDomainRanks } from './services/domain-import-service.js'
import { importGleif } from './services/gleif-import-service.js'
import { matchLegalEntities } from './services/legal-entity-matching-service.js'
import { extractPeopleBatch, type PeopleBatchOptions, type PeopleExtractorDeps } from './services/people-extractor-service.js'
import { createLeadDataService } from './services/lead-data-service.js'
import type { IngestEnv, IngestJob, LeadDataService, LlmPrices } from './types/index.js'

const DOWNLOAD_USER_AGENT = 'LeadexBot/1.0 (open-data import)'
const DOMAIN_BATCH_SIZE = 10_000
const PROFILE_MAX_ATTEMPTS = 3
const PROFILE_RETRY_AFTER_DAYS = 7
const PROFILE_REFRESH_AFTER_DAYS = 90
const GLEIF_FULL_EVERY_DAYS = 30
const GLEIF_BATCH_SIZE = 10_000

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

export function peopleOptions(env: IngestEnv, limit: number = env.INGEST_PEOPLE_MAX_PER_RUN): PeopleBatchOptions {
  return { limit, concurrency: env.INGEST_PEOPLE_CONCURRENCY, maxAttempts: PROFILE_MAX_ATTEMPTS, retryAfterDays: PROFILE_RETRY_AFTER_DAYS, refreshAfterDays: PROFILE_REFRESH_AFTER_DAYS }
}

// Shares the profiler's crawler, model and prices; undefined when the model settings are missing.
export function createPeopleDeps(env: IngestEnv, client: ClickHouseClient, leadData: LeadDataService): PeopleExtractorDeps | undefined {
  const profiler = createProfilerDeps(env, client, leadData)
  if (!profiler) return undefined
  const { siteFetch, llm, model, clock, prices } = profiler
  return { people: createPeopleExtractionRepository(client), leadData, siteFetch, llm, model, clock, prices }
}

function peopleJob(env: IngestEnv, deps: PeopleExtractorDeps | undefined): IngestJob[] {
  if (env.INGEST_PEOPLE_MAX_PER_RUN === 0 || !deps) return []
  return [{
    name: 'people_extractor',
    run: async () => {
      const summary = await extractPeopleBatch(deps, peopleOptions(env))
      const skipped = Object.values(summary.skipped).reduce<number>((sum, count) => sum + (count ?? 0), 0)
      return { written: summary.peopleSaved, skipped }
    },
  }]
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

// GLEIF import, then matching, so companies profiled in this run are matched against the newest registry data.
function gleifJobs(env: IngestEnv, client: ClickHouseClient, leadData: LeadDataService): IngestJob[] {
  const { GLEIF_API_URL: apiUrl, GLEIF_RECORD_URL_BASE: recordUrlBase } = env
  if (!apiUrl || !recordUrlBase) return []
  const entities = createLegalEntitiesRepository(client)
  const source = createGleifRepository(apiUrl, DOWNLOAD_USER_AGENT)
  return [
    { name: 'gleif_import', run: () => importGleif({ source, entities, clock: systemClock }, { fullEveryDays: GLEIF_FULL_EVERY_DAYS, batchSize: GLEIF_BATCH_SIZE }) },
    {
      name: 'gleif_match',
      run: async () => {
        const summary = await matchLegalEntities({ leadData, entities, clock: systemClock, recordUrlBase }, env.INGEST_GLEIF_MATCH_PER_RUN)
        return { written: summary.matched, skipped: summary.noMatch + summary.ambiguous }
      },
    },
  ]
}

// Order matters: new domains are imported before the profiler picks its batch, companies are profiled before
// their people are read and before GLEIF matching. Registry people sources (#23 parts 2-3) register here as they land.
export function createIngestRuntime(env: IngestEnv): IngestRuntime {
  const client: ClickHouseClient = createClickhouseClient(env)
  const leadData = createLeadDataService({ repository: createLeadDataRepository(client), clock: systemClock })
  const jobs = [
    ...domainRanksJob(env, client), ...profilerJob(env, createProfilerDeps(env, client, leadData)),
    ...peopleJob(env, createPeopleDeps(env, client, leadData)), ...gleifJobs(env, client, leadData),
  ]
  return { leadData, jobs, close: () => client.close() }
}
