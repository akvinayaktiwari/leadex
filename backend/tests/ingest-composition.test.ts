import { describe, expect, it } from 'vitest'
import { createIngestRuntime } from '../src/ingest-composition.js'
import { getIngestEnv } from '../src/lib/env.js'

const BASE = { STAGE: 'dev', CLICKHOUSE_URL: 'http://localhost:8123', CLICKHOUSE_USER: 'u', CLICKHOUSE_PASSWORD: 'p', CLICKHOUSE_DATABASE: 'leadex_dev' }
const PROFILER = { INGEST_PROFILE_MAX_PER_RUN: '500', ANTHROPIC_API_KEY: 'sk-test', LLM_MODEL_FAST: 'claude-haiku-5-5', FRONTEND_URL: 'https://leadex.example' }
const GLEIF = { GLEIF_API_URL: 'https://goldencopy.gleif.org/api/v2/golden-copies/publishes/latest', GLEIF_RECORD_URL_BASE: 'https://search.gleif.org/#/record/' }
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
    expect(() => getIngestEnv({ ...BASE, INGEST_PEOPLE_MAX_PER_RUN: '50' })).toThrow(/ANTHROPIC_API_KEY, LLM_MODEL_FAST, FRONTEND_URL/)
    expect(getIngestEnv({ ...BASE, ...PROFILER })).toMatchObject({ INGEST_PROFILE_MAX_PER_RUN: 500, INGEST_PROFILE_CONCURRENCY: 8 })
    expect(() => getIngestEnv({ ...BASE, GLEIF_API_URL: GLEIF.GLEIF_API_URL })).toThrow(/GLEIF_RECORD_URL_BASE/)
    expect(() => getIngestEnv({ ...BASE, INGEST_EMAIL_MAX_PER_RUN: '10' })).toThrow(/EMAIL_VERIFIER/)
    expect(() => getIngestEnv({ ...BASE, EMAIL_VERIFIER: 'bouncer' })).toThrow(/BOUNCER_API_URL, BOUNCER_API_KEY/)
    expect(getIngestEnv(BASE)).toMatchObject({ INGEST_EMAIL_MAX_PER_RUN: 0, EMAIL_VERIFIER: 'none' })
  })

  // protects=jobs register only when configured, in order: domain import, profiler, people, email finder, GLEIF import, GLEIF matching;
  // fails_when=the profiler runs before new domains are imported, matching runs before the registry is refreshed or
  // before new companies exist, or a job runs with no configuration;
  // no_claim=does not run the jobs.
  it('registers jobs from configuration, import first', async () => {
    expect(await jobNames(BASE)).toEqual([])
    expect(await jobNames({ ...BASE, ...RANKS })).toEqual(['common_crawl_domains'])
    expect(await jobNames({ ...BASE, ...RANKS, ...PROFILER })).toEqual(['common_crawl_domains', 'company_profiler'])
    expect(await jobNames({ ...BASE, ...RANKS, ...PROFILER, ...GLEIF })).toEqual(['common_crawl_domains', 'company_profiler', 'gleif_import', 'gleif_match'])
    expect(await jobNames({ ...BASE, ...GLEIF })).toEqual(['gleif_import', 'gleif_match'])
    const people = { ...PROFILER, INGEST_PEOPLE_MAX_PER_RUN: '300' }
    expect(await jobNames({ ...BASE, ...RANKS, ...people, ...GLEIF })).toEqual(['common_crawl_domains', 'company_profiler', 'people_extractor', 'gleif_import', 'gleif_match'])
    expect(await jobNames({ ...BASE, ...PROFILER, INGEST_PROFILE_MAX_PER_RUN: '0', INGEST_PEOPLE_MAX_PER_RUN: '300' })).toEqual(['people_extractor'])
    const email = { INGEST_EMAIL_MAX_PER_RUN: '500', EMAIL_VERIFIER: 'bouncer', BOUNCER_API_URL: 'https://api.usebouncer.com', BOUNCER_API_KEY: 'k' }
    expect(await jobNames({ ...BASE, ...RANKS, ...people, ...email, ...GLEIF })).toEqual(['common_crawl_domains', 'company_profiler', 'people_extractor', 'email_finder', 'gleif_import', 'gleif_match'])
  })
})
