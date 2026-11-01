// Reads people for one batch of profiled companies and prints outcomes, people found, tokens and cost.
// Usage: npm run people:sample --workspace backend -- --limit 200
// Needs the ingest env (CLICKHOUSE_*, STAGE, ANTHROPIC_API_KEY, LLM_MODEL_FAST, FRONTEND_URL) and profiled companies;
// set LLM_FAST_INPUT_USD_PER_MTOK / LLM_FAST_OUTPUT_USD_PER_MTOK to get a cost in USD.
import { parseArgs } from 'node:util'
import { createPeopleDeps, peopleOptions } from '../src/ingest-composition.js'
import { createClickhouseClient } from '../src/lib/clickhouse-client.js'
import { systemClock } from '../src/lib/clock.js'
import { getIngestEnv } from '../src/lib/env.js'
import { createLeadDataRepository } from '../src/repositories/lead-data-repository.js'
import { createLeadDataService } from '../src/services/lead-data-service.js'
import { extractPeopleBatch } from '../src/services/people-extractor-service.js'

function readLimit(): number {
  const { values } = parseArgs({ options: { limit: { type: 'string', default: '200' } } })
  const limit = Number(values.limit)
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`--limit must be a positive integer, got ${values.limit}`)
  return limit
}

const limit = readLimit()
// Forcing the extractor on makes env validation demand the model settings.
const env = getIngestEnv({ ...process.env, INGEST_PEOPLE_MAX_PER_RUN: String(limit) })
const client = createClickhouseClient(env)
try {
  const leadData = createLeadDataService({ repository: createLeadDataRepository(client), clock: systemClock })
  const deps = createPeopleDeps(env, client, leadData)
  if (!deps) throw new Error('Model settings missing (ANTHROPIC_API_KEY, LLM_MODEL_FAST, FRONTEND_URL)')
  const summary = await extractPeopleBatch(deps, peopleOptions(env, limit))
  if (summary.attempted === 0) console.log('No companies to read. Profile some first (npm run profile:sample).')
  const perCompany = summary.costUsd !== undefined && summary.attempted > 0 ? summary.costUsd / summary.attempted : undefined
  console.log(JSON.stringify({ ...summary, costPerCompanyUsd: perCompany, peoplePerCompany: summary.attempted ? summary.peopleSaved / summary.attempted : 0 }, null, 2))
} finally {
  await client.close()
}
