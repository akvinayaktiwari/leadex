import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BLOCKED_COUNTRIES } from '../src/lib/countries.js'
import { createClickhouseClient } from '../src/lib/clickhouse-client.js'
import { LeadDataRuleError } from '../src/lib/errors.js'
import { companyIdFor, personKeyFor, suppressionHash } from '../src/lib/lead-keys.js'
import { createLeadDataRepository } from '../src/repositories/lead-data-repository.js'
import { createLeadDataService } from '../src/services/lead-data-service.js'
import type { CompanyRecord, CompanySearchQuery, LeadDataEnv, PersonRecord } from '../src/types/index.js'
import { runMigrations } from '../tools/clickhouse-migrate.js'
import { manualClock } from './support/in-memory-run-store.js'
import { companyWrite, personWrite } from './support/lead-data-fixtures.js'

// Runs against a real ClickHouse: `docker run -p 8123:8123 -e CLICKHOUSE_USER=leadex -e CLICKHOUSE_PASSWORD=leadex
// -e CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1 clickhouse/clickhouse-server:25.8.33.6`, then CLICKHOUSE_URL=http://localhost:8123
// (CLICKHOUSE_USER / CLICKHOUSE_PASSWORD default to leadex). CI provides it as a service container.
const URL_ = process.env.CLICKHOUSE_URL
const ENV: LeadDataEnv = {
  CLICKHOUSE_URL: URL_ ?? 'http://localhost:8123',
  CLICKHOUSE_USER: process.env.CLICKHOUSE_USER ?? 'leadex',
  CLICKHOUSE_PASSWORD: process.env.CLICKHOUSE_PASSWORD ?? 'leadex',
  CLICKHOUSE_DATABASE: `leadex_test_${Date.now()}`,
}

const QUERY: CompanySearchQuery = {
  countries: [], excludedCountries: [...BLOCKED_COUNTRIES], industries: [], employeeBands: [], keywords: [], technologies: [], limit: 100,
}

function company(domain: string, overrides: Partial<CompanyRecord> = {}): CompanyRecord {
  return {
    companyId: companyIdFor(domain), domain, name: domain, keywords: [], country: 'US', technologies: [], servedMarkets: [],
    updatedAt: '2026-10-29T09:00:00.000Z', ...overrides,
  }
}

function person(firstName: string, overrides: Partial<PersonRecord> = {}): PersonRecord {
  return {
    personKey: personKeyFor(firstName, 'Doe', 'acme.com'), domain: 'acme.com', firstName, lastName: 'Doe', title: 'Engineer',
    country: 'US', isOfficer: false, updatedAt: '2026-10-29T09:00:00.000Z', ...overrides,
  }
}

// protects=CI never silently skips the ClickHouse tests;
// fails_when=the CI job loses its ClickHouse service and the suite below is skipped without notice;
// no_claim=local runs without Docker still skip the suite below.
it('has ClickHouse in CI', () => {
  if (process.env.CI) expect(URL_).toBeTruthy()
})

describe.runIf(URL_)('Leadex Data on ClickHouse', () => {
  const client = createClickhouseClient(ENV)
  const admin = createClickhouseClient(ENV, { withDatabase: false })
  const repository = createLeadDataRepository(client)

  beforeAll(async () => {
    expect(await runMigrations(ENV)).toEqual(['001_leadex_data.sql'])
  })

  afterAll(async () => {
    await admin.command({ query: `DROP DATABASE IF EXISTS ${ENV.CLICKHOUSE_DATABASE}` })
    await Promise.all([client.close(), admin.close()])
  })

  // protects=migrations are recorded and never re-applied;
  // fails_when=a second run re-executes 001 or forgets it was applied;
  // no_claim=does not test a migration that alters existing data.
  it('applies migrations once', async () => {
    expect(await runMigrations(ENV)).toEqual([])
  })

  // protects=company rows round-trip exactly: optional fields come back undefined (not ''), arrays and UTC timestamps intact;
  // fails_when=a mapper swaps snake/camel names, turns '' into a value, or shifts the timestamp by a time zone;
  // no_claim=n/a.
  it('round-trips a company', async () => {
    const stored = company('roundtrip.example', { keywords: ['CRM'], technologies: ['go'], servedMarkets: ['US', 'IN'], employeeBand: '51-200', city: 'Austin' })
    await repository.insertCompanies([stored])
    const [found] = await repository.searchCompanies({ ...QUERY, keywords: ['crm'] })
    expect(found).toEqual({ ...stored, legalName: undefined, lei: undefined, description: undefined, industry: undefined, region: undefined })
  })

  // protects=the newest version of a company wins (ReplacingMergeTree + FINAL), so re-crawls update instead of duplicating;
  // fails_when=a search returns both versions or the older name;
  // no_claim=relies on updated_at increasing; two writes in the same second keep either.
  it('returns only the latest version of a company', async () => {
    await repository.insertCompanies([company('dedupe.example', { name: 'Old name', updatedAt: '2026-10-01T00:00:00.000Z' })])
    await repository.insertCompanies([company('dedupe.example', { name: 'New name', updatedAt: '2026-10-29T00:00:00.000Z' })])
    const rows = (await repository.searchCompanies(QUERY)).filter((row) => row.domain === 'dedupe.example')
    expect(rows.map((row) => row.name)).toEqual(['New name'])
  })

  // protects=the SQL itself excludes blocked countries, and each filter (country, industry, band, keyword, technology) narrows results;
  // fails_when=a French row inserted around the service is returned, or a filter is ignored or case-sensitive;
  // no_claim=does not test relevance ranking (there is none yet; newest first).
  it('filters in SQL and always excludes blocked countries', async () => {
    await repository.insertCompanies([
      company('fr.example', { country: 'FR', industry: 'saas' }),
      company('in-saas.example', { country: 'IN', industry: 'saas', employeeBand: '11-50', keywords: ['Lead Gen'], technologies: ['HubSpot'] }),
      company('in-retail.example', { country: 'IN', industry: 'retail', employeeBand: '5001+' }),
    ])
    const domains = async (query: Partial<CompanySearchQuery>): Promise<string[]> =>
      (await repository.searchCompanies({ ...QUERY, ...query })).map((row) => row.domain).sort()
    expect(await domains({ industries: ['saas'] })).toEqual(['in-saas.example'])
    expect(await domains({ countries: ['IN'] })).toEqual(['in-retail.example', 'in-saas.example'])
    expect(await domains({ countries: ['IN'], employeeBands: ['11-50'] })).toEqual(['in-saas.example'])
    expect(await domains({ keywords: ['lead gen'] })).toEqual(['in-saas.example'])
    expect(await domains({ technologies: ['hubspot'] })).toEqual(['in-saas.example'])
    expect(await domains({ countries: ['FR'] })).toEqual([])
  })

  // protects=people search matches title terms case-insensitively, lists officers first, and excludes blocked countries;
  // fails_when=a "MARKETING" title misses "marketing", a UK person is returned, or ordering drops officers below staff;
  // no_claim=substring matching only; no synonyms ("CMO" does not match "marketing").
  it('searches people by domain and title terms', async () => {
    await repository.insertPeople([
      person('Asha', { title: 'Head of MARKETING' }),
      person('Ravi', { title: 'Founder', isOfficer: true }),
      person('Uma', { title: 'Marketing Lead', country: 'GB' }),
    ])
    const names = async (terms: string[]): Promise<string[]> =>
      (await repository.searchPeople({ domains: ['acme.com'], excludedCountries: [...BLOCKED_COUNTRIES], titleTerms: terms, limit: 10 })).map((row) => row.firstName)
    expect(await names(['marketing'])).toEqual(['Asha'])
    expect(await names([])).toEqual(['Ravi', 'Asha'])
  })

  // protects=suppression lookups return exactly the suppressed subset of the given hashes;
  // fails_when=an unsuppressed hash is reported, or a kind mismatch (email vs domain) matches;
  // no_claim=n/a.
  it('finds suppressed hashes by kind', async () => {
    const hash = suppressionHash('domain', 'blocked.example')
    await repository.insertSuppression([{ kind: 'domain', valueHash: hash, reason: 'opt_out', createdAt: '2026-10-29T09:00:00.000Z' }])
    expect(await repository.findSuppressed('domain', [hash, suppressionHash('domain', 'other.example')])).toEqual(new Set([hash]))
    expect(await repository.findSuppressed('email', [hash])).toEqual(new Set())
  })

  // protects=the service and ClickHouse agree end to end: saved records come back with every fact, and a row written
  // around the service (no facts) is refused at delivery (criterion 10c on the real database);
  // fails_when=facts are stored under a different entity id than the record, or an unsourced row is deliverable;
  // no_claim=does not cover the remove-me deletion path (#26).
  it('stores provenance and refuses unsourced rows at delivery', async () => {
    const service = createLeadDataService({ repository, clock: manualClock('2026-10-29T10:00:00.000Z') })
    await service.saveCompany(companyWrite({ domain: 'sourced.example', keywords: ['sourced'] }))
    await service.savePerson(personWrite({ domain: 'sourced.example', title: 'VP Sales' }))
    const [found] = await service.findCompanies({ industries: [], employeeMin: 0, employeeMax: 0, countries: ['US'], keywords: ['sourced'], technologies: [] }, 10)
    const [deliverable] = await service.loadDeliverableCompanies([found!])
    expect(deliverable?.facts.every((fact) => fact.entityId === companyIdFor('sourced.example') && fact.sourceUrl.startsWith('https://'))).toBe(true)
    const people = await service.findPeople(['sourced.example'], ['sales'], 10)
    expect(await service.loadDeliverablePeople(people)).toHaveLength(1)
    const [bare] = await repository.searchCompanies({ ...QUERY, keywords: ['crm'] })
    await expect(service.loadDeliverableCompanies([bare!])).rejects.toBeInstanceOf(LeadDataRuleError)
  })
})
