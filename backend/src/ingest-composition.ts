// Composition root for the scheduled ingest task: the Leadex Data service and the import jobs.
import type { ClickHouseClient } from '@clickhouse/client'
import { createClickhouseClient } from './lib/clickhouse-client.js'
import { systemClock } from './lib/clock.js'
import { createCommonCrawlRepository } from './repositories/common-crawl-repository.js'
import { createDomainCandidatesRepository } from './repositories/domain-candidates-repository.js'
import { createLeadDataRepository } from './repositories/lead-data-repository.js'
import { importDomainRanks } from './services/domain-import-service.js'
import { createLeadDataService } from './services/lead-data-service.js'
import type { IngestEnv, IngestJob, LeadDataService } from './types/index.js'

const DOWNLOAD_USER_AGENT = 'LeadexBot/1.0 (open-data import)'
const DOMAIN_BATCH_SIZE = 10_000

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

// Sources register here as they land (profiler and GLEIF in #22; SEC EDGAR, India, US states, Web Data Commons in #23).
export function createIngestRuntime(env: IngestEnv): IngestRuntime {
  const client: ClickHouseClient = createClickhouseClient(env)
  const leadData = createLeadDataService({ repository: createLeadDataRepository(client), clock: systemClock })
  return { leadData, jobs: [...domainRanksJob(env, client)], close: () => client.close() }
}
