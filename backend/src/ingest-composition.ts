// Composition root for the scheduled ingest task: the Leadex Data service and the import jobs.
import type { ClickHouseClient } from '@clickhouse/client'
import { createClickhouseClient } from './lib/clickhouse-client.js'
import { systemClock } from './lib/clock.js'
import { createLeadDataRepository } from './repositories/lead-data-repository.js'
import { createLeadDataService } from './services/lead-data-service.js'
import type { IngestEnv, IngestJob, LeadDataService } from './types/index.js'

export interface IngestRuntime {
  leadData: LeadDataService
  jobs: IngestJob[]
  close(): Promise<void>
}

// Sources register here as they land (GLEIF in #22; SEC EDGAR, India, US states, Web Data Commons in #23).
function createJobs(_leadData: LeadDataService): IngestJob[] {
  return []
}

export function createIngestRuntime(env: IngestEnv): IngestRuntime {
  const client: ClickHouseClient = createClickhouseClient(env)
  const leadData = createLeadDataService({ repository: createLeadDataRepository(client), clock: systemClock })
  return { leadData, jobs: createJobs(leadData), close: () => client.close() }
}
