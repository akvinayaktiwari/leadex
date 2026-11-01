import { describe, expect, it } from 'vitest'
import { createIngestRuntime } from '../src/ingest-composition.js'
import { getIngestEnv } from '../src/lib/env.js'

const BASE = { STAGE: 'dev', CLICKHOUSE_URL: 'http://localhost:8123', CLICKHOUSE_USER: 'u', CLICKHOUSE_PASSWORD: 'p', CLICKHOUSE_DATABASE: 'leadex_dev' }
const PROFILER = { INGEST_PROFILE_MAX_PER_RUN: '500', ANTHROPIC_API_KEY: 'sk-test', LLM_MODEL_FAST: 'claude-haiku-5-5', FRONTEND_URL: 'https://leadex.example' }
const RANKS = { CC_DOMAIN_RANKS_URL: 'https://data.commoncrawl.org/projects/hyperlinkgraph/cc-main-2026-apr-may-jun/domain/r.txt.gz' }

async function jobNames(source: Record<string, string>): Promise<string[]> {
  const runtime = createIngestRuntime(getIngestEnv(source))
  try {
    return runtime.jobs.map((job) => job.name)
  } finally {
    await runtime.close()
  }
}

describe('ingest composition', () => {
  // protects=the profiler is off by default and, when turned on, the model settings must be present;
  // fails_when=INGEST_PROFILE_MAX_PER_RUN=500 starts without an API key (every domain would fail llm_failed), or the
  // profiler starts with no setting at all;
  // no_claim=does not check that the key is valid.
  it('requires model settings only when the profiler is on', () => {
    expect(getIngestEnv(BASE).INGEST_PROFILE_MAX_PER_RUN).toBe(0)
    expect(() => getIngestEnv({ ...BASE, INGEST_PROFILE_MAX_PER_RUN: '500' })).toThrow(/ANTHROPIC_API_KEY, LLM_MODEL_FAST, FRONTEND_URL/)
    expect(getIngestEnv({ ...BASE, ...PROFILER })).toMatchObject({ INGEST_PROFILE_MAX_PER_RUN: 500, INGEST_PROFILE_CONCURRENCY: 8 })
  })

  // protects=jobs register only when configured, and the domain import runs before the profiler;
  // fails_when=the profiler runs before new domains are imported, or a job runs with no configuration;
  // no_claim=does not run the jobs.
  it('registers jobs from configuration, import first', async () => {
    expect(await jobNames(BASE)).toEqual([])
    expect(await jobNames({ ...BASE, ...RANKS })).toEqual(['common_crawl_domains'])
    expect(await jobNames({ ...BASE, ...RANKS, ...PROFILER })).toEqual(['common_crawl_domains', 'company_profiler'])
  })
})
