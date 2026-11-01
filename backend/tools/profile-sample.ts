// Profiles one batch of domains and prints outcomes, tokens and cost, to measure cost per company before scaling up.
// Usage: npm run profile:sample --workspace backend -- --limit 1000
// Needs the ingest env (CLICKHOUSE_*, STAGE, ANTHROPIC_API_KEY, LLM_MODEL_FAST, FRONTEND_URL) and imported domains;
// set LLM_FAST_INPUT_USD_PER_MTOK / LLM_FAST_OUTPUT_USD_PER_MTOK to get a cost in USD.
import { parseArgs } from 'node:util'
import { createProfilerDeps, profileOptions } from '../src/ingest-composition.js'
import { createClickhouseClient } from '../src/lib/clickhouse-client.js'
import { systemClock } from '../src/lib/clock.js'
import { getIngestEnv } from '../src/lib/env.js'
import { createLeadDataRepository } from '../src/repositories/lead-data-repository.js'
import { profileBatch } from '../src/services/company-profiler-service.js'
import { createLeadDataService } from '../src/services/lead-data-service.js'
import type { ProfileBatchSummary } from '../src/types/index.js'

function readLimit(): number {
  const { values } = parseArgs({ options: { limit: { type: 'string', default: '1000' } } })
  const limit = Number(values.limit)
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`--limit must be a positive integer, got ${values.limit}`)
  return limit
}

function report(summary: ProfileBatchSummary): Record<string, unknown> {
  const perProfiled = summary.costUsd !== undefined && summary.profiled > 0 ? summary.costUsd / summary.profiled : undefined
  return {
    ...summary,
    costPerProfiledUsd: perProfiled,
    costPer1000ProfiledUsd: perProfiled === undefined ? undefined : perProfiled * 1000,
    note: summary.costUsd === undefined ? 'Set LLM_FAST_INPUT_USD_PER_MTOK and LLM_FAST_OUTPUT_USD_PER_MTOK for a USD cost.' : undefined,
  }
}

const limit = readLimit()
// Forcing the profiler on makes env validation demand the model settings.
const env = getIngestEnv({ ...process.env, INGEST_PROFILE_MAX_PER_RUN: String(limit) })
const client = createClickhouseClient(env)
try {
  const leadData = createLeadDataService({ repository: createLeadDataRepository(client), clock: systemClock })
  const deps = createProfilerDeps(env, client, leadData)
  if (!deps) throw new Error('Profiler settings missing (ANTHROPIC_API_KEY, LLM_MODEL_FAST, FRONTEND_URL)')
  const summary = await profileBatch(deps, profileOptions(env, limit))
  if (summary.attempted === 0) console.log('No domains to profile. Import a Common Crawl release first (CC_DOMAIN_RANKS_URL + node dist/ingest.mjs).')
  console.log(JSON.stringify(report(summary), null, 2))
} finally {
  await client.close()
}
