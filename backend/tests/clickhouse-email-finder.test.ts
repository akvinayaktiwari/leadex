import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BLOCKED_COUNTRIES } from '../src/lib/countries.js'
import { createClickhouseClient } from '../src/lib/clickhouse-client.js'
import { companyIdFor, personKeyFor } from '../src/lib/lead-keys.js'
import { createEmailFinderRepository } from '../src/repositories/email-finder-repository.js'
import { createLeadDataRepository } from '../src/repositories/lead-data-repository.js'
import { createPeopleExtractionRepository } from '../src/repositories/people-extraction-repository.js'
import type { EmailSelection, LeadDataEnv, PersonRecord } from '../src/types/index.js'
import { runMigrations } from '../tools/clickhouse-migrate.js'

// Skipped without CLICKHOUSE_URL (required in CI by clickhouse-lead-data.test.ts).
const URL_ = process.env.CLICKHOUSE_URL
const ENV: LeadDataEnv = {
  CLICKHOUSE_URL: URL_ ?? 'http://localhost:8123', CLICKHOUSE_USER: process.env.CLICKHOUSE_USER ?? 'leadex',
  CLICKHOUSE_PASSWORD: process.env.CLICKHOUSE_PASSWORD ?? 'leadex', CLICKHOUSE_DATABASE: `leadex_test_email_${Date.now()}`,
}
const NOW = '2026-11-01T12:00:00.000Z'
const SELECTION: EmailSelection = { limit: 10, excludedCountries: [...BLOCKED_COUNTRIES], retryUnknownBefore: '2026-10-25T00:00:00.000Z', recheckBefore: '2026-08-01T00:00:00.000Z' }

const person = (first: string, last: string, seniority: string, overrides: Partial<PersonRecord> = {}): PersonRecord => ({
  personKey: personKeyFor(first, last, 'acme.com'), domain: 'acme.com', firstName: first, lastName: last, title: seniority, seniority,
  country: 'IN', isOfficer: false, updatedAt: NOW, ...overrides,
})

describe.runIf(URL_)('email finder on ClickHouse', () => {
  const client = createClickhouseClient(ENV)
  const admin = createClickhouseClient(ENV, { withDatabase: false })
  const finder = createEmailFinderRepository(client)

  beforeAll(async () => {
    await runMigrations(ENV)
    const leadData = createLeadDataRepository(client)
    await leadData.insertCompanies([{ companyId: companyIdFor('acme.com'), domain: 'acme.com', name: 'Acme', keywords: [], employeeBand: '11-50', country: 'IN', technologies: [], servedMarkets: [], updatedAt: NOW }])
    await leadData.insertPeople([
      person('Staff', 'Member', 'staff'), person('Asha', 'Rao', 'owner'), person('Ravi', 'Kumar', 'manager'), person('Priya', 'Shah', 'head'),
      person('Old', 'Unknown', 'staff'), person('Euro', 'Person', 'owner', { personKey: 'eu-key', country: 'FR' }),
    ])
    await finder.insertResults([
      { personKey: personKeyFor('Priya', 'Shah', 'acme.com'), email: 'priya.shah@acme.com', pattern: 'first.last', status: 'valid', checkedBy: 'bouncer', checkedAt: NOW },
      { personKey: personKeyFor('Old', 'Unknown', 'acme.com'), email: 'old.unknown@acme.com', pattern: 'first.last', status: 'unknown', checkedBy: 'bouncer', checkedAt: '2026-10-01T00:00:00.000Z' },
    ])
    await createPeopleExtractionRepository(client).insertPublishedEmails([
      { domain: 'acme.com', email: 'asha.rao@acme.com', kind: 'personal', personKey: personKeyFor('Asha', 'Rao', 'acme.com'), sourceUrl: 'https://acme.com/team', seenAt: NOW },
      { domain: 'acme.com', email: 'j.doe@acme.com', kind: 'personal', personKey: '', sourceUrl: 'https://acme.com/contact', seenAt: NOW },
      { domain: 'acme.com', email: 'info@acme.com', kind: 'general', personKey: '', sourceUrl: 'https://acme.com/contact', seenAt: NOW },
    ])
    await finder.insertChecks([{ personKey: 'x', domain: 'acme.com', email: 'rkumar@acme.com', status: 'invalid', reason: 'undeliverable:rejected_email', checkedBy: 'bouncer', checkedAt: NOW }])
  })

  afterAll(async () => {
    await admin.command({ query: `DROP DATABASE IF EXISTS ${ENV.CLICKHOUSE_DATABASE}` })
    await Promise.all([client.close(), admin.close()])
  })

  // protects=people needing an email come senior first, with their company's size band; a person with a fresh valid email is
  // skipped, an old unknown is retried, and a blocked-country person is never selected;
  // fails_when=credits are spent on staff before the owner, a verified person is re-checked every run, or an EU person is checked;
  // no_claim=n/a.
  it('selects people needing an email, senior first', async () => {
    const picked = await finder.peopleNeedingEmail(SELECTION)
    const names = picked.map((row) => `${row.person.firstName}:${row.employeeBand}`)
    expect(names.slice(0, 2)).toEqual(['Asha:11-50', 'Ravi:11-50'])
    // Two staff with the same update time: their order is a tie, so only membership is checked.
    expect(new Set(names.slice(2))).toEqual(new Set(['Old:11-50', 'Staff:11-50']))
  })

  // protects=evidence combines published personal addresses (linked with names, or unlinked) and verified addresses, never
  // general inboxes; invalid addresses come from the check log;
  // fails_when=info@ teaches a format, a linked address loses its person's name, or a bounced guess can be tried again;
  // no_claim=n/a.
  it('loads evidence, colleagues and known-invalid addresses', async () => {
    const evidence = (await finder.evidence(['acme.com'])).map((row) => `${row.email}:${row.strength}:${row.firstName}`).sort()
    expect(evidence).toEqual(['asha.rao@acme.com:published_linked:Asha', 'j.doe@acme.com:published_unlinked:', 'priya.shah@acme.com:verified:Priya'])
    expect((await finder.colleagues(['acme.com'])).length).toBe(6)
    expect(await finder.invalidAddresses(['acme.com'])).toEqual(new Set(['rkumar@acme.com']))
  })
})
