import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClickhouseClient } from '../src/lib/clickhouse-client.js'
import { createCrawlStatusRepository } from '../src/repositories/crawl-status-repository.js'
import { createDomainCandidatesRepository } from '../src/repositories/domain-candidates-repository.js'
import type { CrawlStatusEntry, LeadDataEnv, ProfileSelection } from '../src/types/index.js'
import { runMigrations } from '../tools/clickhouse-migrate.js'

// Skipped without CLICKHOUSE_URL (required in CI by clickhouse-lead-data.test.ts).
const URL_ = process.env.CLICKHOUSE_URL
const ENV: LeadDataEnv = {
  CLICKHOUSE_URL: URL_ ?? 'http://localhost:8123',
  CLICKHOUSE_USER: process.env.CLICKHOUSE_USER ?? 'leadex',
  CLICKHOUSE_PASSWORD: process.env.CLICKHOUSE_PASSWORD ?? 'leadex',
  CLICKHOUSE_DATABASE: `leadex_test_status_${Date.now()}`,
}

const NOW = '2026-11-01T12:00:00.000Z'
const SELECTION: ProfileSelection = {
  limit: 10, excludedDomains: ['google.com'], maxAttempts: 3,
  retryFailedBefore: '2026-10-25T12:00:00.000Z', refreshProfiledBefore: '2026-08-03T12:00:00.000Z',
}

const status = (domain: string, entry: Partial<CrawlStatusEntry>): CrawlStatusEntry => ({ domain, status: 'profiled', reason: '', attempts: 0, checkedAt: NOW, ...entry })

describe.runIf(URL_)('crawl status on ClickHouse', () => {
  const client = createClickhouseClient(ENV)
  const admin = createClickhouseClient(ENV, { withDatabase: false })
  const statuses = createCrawlStatusRepository(client)

  beforeAll(async () => {
    await runMigrations(ENV)
    const domains = ['google.com', 'new.com', 'done.com', 'stale.com', 'failed-recent.com', 'failed-old.com', 'failed-max.com', 'skipped.com']
    await createDomainCandidatesRepository(client).insertCandidates(domains.map((domain, i) => ({
      domain, tld: 'com', harmonicRank: i + 1, harmonicValue: 1, pagerankRank: 1, hosts: 1, release: 'cc-main-test', importedAt: NOW,
    })))
    await statuses.recordStatus([
      status('done.com', {}),
      status('stale.com', { checkedAt: '2026-07-01T00:00:00.000Z' }),
      status('failed-recent.com', { status: 'failed', reason: 'unreachable', attempts: 1, checkedAt: '2026-10-31T00:00:00.000Z' }),
      status('failed-old.com', { status: 'failed', reason: 'unreachable', attempts: 2, checkedAt: '2026-10-01T00:00:00.000Z' }),
      status('failed-max.com', { status: 'failed', reason: 'unreachable', attempts: 3, checkedAt: '2026-10-01T00:00:00.000Z' }),
      status('skipped.com', { status: 'skipped', reason: 'unknown_country' }),
    ])
  })

  afterAll(async () => {
    await admin.command({ query: `DROP DATABASE IF EXISTS ${ENV.CLICKHOUSE_DATABASE}` })
    await Promise.all([client.close(), admin.close()])
  })

  // protects=selection order and eligibility: new domains, old failures under the attempt cap, and stale profiles come back
  // in rank order; excluded platforms, recent failures, maxed-out failures and fresh results do not;
  // fails_when=the profiler re-crawls a domain every run, retries a dead site forever, or crawls google.com;
  // no_claim=does not test concurrent profilers picking the same domain (one ingest task runs at a time).
  it('picks eligible domains in rank order', async () => {
    const picked = await statuses.nextToProfile(SELECTION)
    expect(picked.map((candidate) => candidate.domain)).toEqual(['new.com', 'stale.com', 'failed-old.com'])
    expect(picked.find((candidate) => candidate.domain === 'failed-old.com')?.attempts).toBe(2)
    expect(picked.find((candidate) => candidate.domain === 'new.com')?.attempts).toBe(0)
  })

  // protects=the newest status row wins, so a domain profiled now stops being selected;
  // fails_when=an old failed row shadows the new profiled row;
  // no_claim=n/a.
  it('uses the latest status per domain', async () => {
    await statuses.recordStatus([status('new.com', { checkedAt: '2026-11-01T12:30:00.000Z' })])
    expect((await statuses.nextToProfile(SELECTION)).map((candidate) => candidate.domain)).toEqual(['stale.com', 'failed-old.com'])
  })
})
