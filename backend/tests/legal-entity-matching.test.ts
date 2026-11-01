import { describe, expect, it } from 'vitest'
import { createLeadDataService } from '../src/services/lead-data-service.js'
import { matchLegalEntities } from '../src/services/legal-entity-matching-service.js'
import type { LegalEntitiesRepository, LegalEntityNameRow } from '../src/types/index.js'
import { manualClock } from './support/in-memory-run-store.js'
import { companyWrite, memoryLeadData } from './support/lead-data-fixtures.js'

const RECORD_URL = 'https://search.gleif.org/#/record/'

function nameRow(nameKey: string, lei: string, overrides: Partial<LegalEntityNameRow> = {}): LegalEntityNameRow {
  return { nameKey, lei, legalCountry: 'US', hqCountry: 'US', entityStatus: 'ACTIVE', registrationStatus: 'ISSUED', publishDate: '2026-11-01T08:00:00.000Z', ...overrides }
}

function entitiesWith(rows: LegalEntityNameRow[]): LegalEntitiesRepository & { asked: string[][] } {
  const asked: string[][] = []
  return {
    asked,
    async findNames(keys: string[]) { asked.push(keys); return rows.filter((row) => keys.includes(row.nameKey)) },
    async insertEntities() {}, async insertNames() {}, async latestImport() { return undefined }, async hasImport() { return false }, async recordImport() {},
  }
}

async function setup(rows: LegalEntityNameRow[], companies: { domain: string; legalName: string; country?: string }[]) {
  const repository = memoryLeadData()
  const clock = manualClock('2026-11-01T10:00:00.000Z')
  const leadData = createLeadDataService({ repository, clock })
  for (const company of companies) {
    const write = companyWrite({ domain: company.domain, name: company.domain, legalName: company.legalName, country: company.country ?? 'US' })
    await leadData.saveCompany(write)
  }
  const entities = entitiesWith(rows)
  return { repository, entities, deps: { leadData, entities, clock, recordUrlBase: RECORD_URL } }
}

describe('legal entity matching', () => {
  // protects=a company gets an LEI only when exactly one active entity with the same name key exists in its country, and the
  // LEI is stored with a GLEIF registry fact;
  // fails_when=a same-named company in another country is matched, two candidates pick one at random, an inactive or retired
  // entity is matched, or the LEI is stored without its source;
  // no_claim=does not catch two different companies that share a legal name in the same country with only one in GLEIF.
  it('matches only unique, active, same-country entities', async () => {
    const { repository, deps } = await setup([
      nameRow('acme technologies', 'LEI-ACME', { legalCountry: 'IN', hqCountry: 'IN' }),
      nameRow('acme technologies', 'LEI-ACME-US-INACTIVE', { entityStatus: 'INACTIVE' }),
      nameRow('twin', 'LEI-T1'), nameRow('twin', 'LEI-T2'),
      nameRow('retired', 'LEI-R', { registrationStatus: 'RETIRED' }),
      nameRow('lapsed', 'LEI-L', { registrationStatus: 'LAPSED' }),
    ], [
      { domain: 'acme.in', legalName: 'ACME TECHNOLOGIES PRIVATE LIMITED', country: 'IN' },
      { domain: 'acme-us.com', legalName: 'Acme Technologies Inc' },
      { domain: 'twin.com', legalName: 'Twin Ltd' },
      { domain: 'retired.com', legalName: 'Retired LLC' },
      { domain: 'lapsed.com', legalName: 'Lapsed Co' },
    ])
    expect(await matchLegalEntities(deps, 100)).toEqual({ checked: 5, matched: 2, noMatch: 2, ambiguous: 1 })
    const leis = Object.fromEntries((await repository.findCompaniesByDomain(['acme.in', 'acme-us.com', 'twin.com', 'retired.com', 'lapsed.com'])).map((c) => [c.domain, c.lei ?? null]))
    expect(leis).toEqual({ 'acme.in': 'LEI-ACME', 'acme-us.com': null, 'twin.com': null, 'retired.com': null, 'lapsed.com': 'LEI-L' })
    const fact = repository.facts.find((f) => f.field === 'lei' && f.value === 'LEI-ACME')
    expect(fact).toMatchObject({ source: 'gleif', method: 'registry', licenceScope: 'open_data', sourceUrl: `${RECORD_URL}LEI-ACME` })
  })

  // protects=a matched company leaves the queue, and names are looked up once per run in bulk;
  // fails_when=the same company is re-matched every run, or one lookup is made per company;
  // no_claim=unmatched companies stay in the queue and are retried (cheap lookups).
  it('removes matched companies from the queue and looks names up in bulk', async () => {
    const { deps, entities } = await setup([nameRow('solo', 'LEI-S')], [{ domain: 'solo.com', legalName: 'Solo Inc' }, { domain: 'other.com', legalName: 'Other Inc' }])
    await matchLegalEntities(deps, 100)
    expect(entities.asked).toEqual([['solo', 'other']])
    expect(await matchLegalEntities(deps, 100)).toEqual({ checked: 1, matched: 0, noMatch: 1, ambiguous: 0 })
  })
})
