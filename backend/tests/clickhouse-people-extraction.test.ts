import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BLOCKED_COUNTRIES } from '../src/lib/countries.js'
import { createClickhouseClient } from '../src/lib/clickhouse-client.js'
import { companyIdFor } from '../src/lib/lead-keys.js'
import { createLeadDataRepository } from '../src/repositories/lead-data-repository.js'
import { createPeopleExtractionRepository } from '../src/repositories/people-extraction-repository.js'
import type { CompanyRecord, LeadDataEnv, PeopleSelection, PeopleStatusEntry } from '../src/types/index.js'
import { runMigrations } from '../tools/clickhouse-migrate.js'

// Skipped without CLICKHOUSE_URL (required in CI by clickhouse-lead-data.test.ts).
const URL_ = process.env.CLICKHOUSE_URL
const ENV: LeadDataEnv = {
  CLICKHOUSE_URL: URL_ ?? 'http://localhost:8123', CLICKHOUSE_USER: process.env.CLICKHOUSE_USER ?? 'leadex',
  CLICKHOUSE_PASSWORD: process.env.CLICKHOUSE_PASSWORD ?? 'leadex', CLICKHOUSE_DATABASE: `leadex_test_people_${Date.now()}`,
}
const NOW = '2026-11-01T12:00:00.000Z'
const SELECTION: PeopleSelection = {
  limit: 10, excludedCountries: [...BLOCKED_COUNTRIES], maxAttempts: 3, retryFailedBefore: '2026-10-25T12:00:00.000Z', refreshBefore: '2026-08-03T12:00:00.000Z',
}

const company = (domain: string, updatedAt: string, country = 'US'): CompanyRecord => ({
  companyId: companyIdFor(domain), domain, name: domain, keywords: [], country, technologies: [], servedMarkets: [], updatedAt,
})
const status = (domain: string, entry: Partial<PeopleStatusEntry>): PeopleStatusEntry => ({ domain, status: 'done', reason: '', peopleFound: 2, attempts: 0, checkedAt: NOW, ...entry })

describe.runIf(URL_)('people extraction on ClickHouse', () => {
  const client = createClickhouseClient(ENV)
  const admin = createClickhouseClient(ENV, { withDatabase: false })
  const people = createPeopleExtractionRepository(client)

  beforeAll(async () => {
    await runMigrations(ENV)
    await createLeadDataRepository(client).insertCompanies([
      company('new.com', '2026-10-31T00:00:00.000Z'), company('newest.com', '2026-11-01T00:00:00.000Z'), company('done.com', '2026-10-30T00:00:00.000Z'),
      company('stale.com', '2026-10-01T00:00:00.000Z'), company('failed-old.com', '2026-10-02T00:00:00.000Z'),
      company('failed-recent.com', '2026-10-03T00:00:00.000Z'), company('leaked-eu.com', '2026-11-01T00:00:00.000Z', 'FR'),
    ])
    await people.recordStatus([
      status('done.com', {}), status('stale.com', { checkedAt: '2026-07-01T00:00:00.000Z' }),
      status('failed-old.com', { status: 'failed', reason: 'unreachable', attempts: 1, checkedAt: '2026-10-01T00:00:00.000Z' }),
      status('failed-recent.com', { status: 'failed', reason: 'unreachable', attempts: 1, checkedAt: '2026-10-31T00:00:00.000Z' }),
    ])
  })

  afterAll(async () => {
    await admin.command({ query: `DROP DATABASE IF EXISTS ${ENV.CLICKHOUSE_DATABASE}` })
    await Promise.all([client.close(), admin.close()])
  })

  // protects=selection returns full company records, newest first, for never-read, stale and old-failed companies only, and
  // never a blocked-country company even if one were stored;
  // fails_when=done or recently failed companies are re-read every run, or an EU row leaks into extraction;
  // no_claim=n/a.
  it('selects companies to read people for', async () => {
    const picked = await people.nextCompanies(SELECTION)
    expect(picked.map((candidate) => `${candidate.company.domain}/${candidate.attempts}`)).toEqual(['newest.com/0', 'new.com/0', 'failed-old.com/1', 'stale.com/0'])
    expect(picked[0]?.company).toMatchObject({ companyId: companyIdFor('newest.com'), country: 'US' })
  })

  // protects=published emails round-trip with their page and owner key, and re-seeing an address replaces it;
  // fails_when=the same address is listed twice or loses its source page;
  // no_claim=n/a.
  it('stores published emails', async () => {
    const row = { domain: 'new.com', email: 'info@new.com', kind: 'general' as const, personKey: '', sourceUrl: 'https://new.com/contact', seenAt: NOW }
    await people.insertPublishedEmails([row])
    await people.insertPublishedEmails([{ ...row, sourceUrl: 'https://new.com/about', seenAt: '2026-11-02T00:00:00.000Z' }])
    expect(await people.listPublishedEmails('new.com')).toEqual([{ ...row, sourceUrl: 'https://new.com/about', seenAt: '2026-11-02T00:00:00.000Z' }])
  })
})
