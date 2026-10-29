import type {
  CompanyField,
  CompanyRecord,
  CompanySearchQuery,
  CompanyWrite,
  EntityType,
  Fact,
  FactInput,
  LeadDataRepository,
  PeopleSearchQuery,
  PersonField,
  PersonRecord,
  PersonWrite,
  SuppressionEntry,
  SuppressionKind,
} from '../../src/types/index.js'

export function websiteFact<F extends string>(field: F, value: string, url = 'https://acme.example.com/about'): FactInput<F> {
  return { field, value, source: 'website', sourceUrl: url, method: 'page_extract', licenceScope: 'owned', retrievedAt: '2026-10-29T08:00:00.000Z' }
}

// A company write whose facts back every populated field.
export function companyWrite(overrides: Partial<CompanyWrite['company']> = {}): CompanyWrite {
  const company: CompanyWrite['company'] = {
    domain: 'acme.com', name: 'Acme', keywords: ['crm', 'Real Estate'], employeeBand: '11-50',
    country: 'US', industry: 'software', technologies: ['HubSpot'], servedMarkets: ['US'], ...overrides,
  }
  const facts = (Object.keys(company) as CompanyField[])
    .filter((field) => {
      const value = company[field]
      return value !== undefined && !(Array.isArray(value) && value.length === 0)
    })
    .map((field) => websiteFact(field, JSON.stringify(company[field])))
  return { company, facts }
}

export function personWrite(overrides: Partial<PersonWrite['person']> = {}): PersonWrite {
  const person: PersonWrite['person'] = {
    domain: 'acme.com', firstName: 'Asha', lastName: 'Rao', title: 'Head of Marketing', country: 'US', isOfficer: false, ...overrides,
  }
  const fields: PersonField[] = ['domain', 'firstName', 'lastName', 'title', 'country']
  if (person.isOfficer) fields.push('isOfficer')
  if (person.seniority) fields.push('seniority')
  if (person.department) fields.push('department')
  return { person, facts: fields.map((field) => websiteFact(field, String(person[field]), 'https://acme.example.com/team')) }
}

export interface MemoryLeadData extends LeadDataRepository {
  companies: CompanyRecord[]
  people: PersonRecord[]
  facts: Fact[]
  suppression: SuppressionEntry[]
}

// Stores everything and returns it unfiltered by country, so tests can prove the service's own guard.
export function memoryLeadData(): MemoryLeadData {
  const store: Pick<MemoryLeadData, 'companies' | 'people' | 'facts' | 'suppression'> = { companies: [], people: [], facts: [], suppression: [] }
  return {
    ...store,
    async insertCompanies(rows: CompanyRecord[]) { store.companies.push(...rows) },
    async insertPeople(rows: PersonRecord[]) { store.people.push(...rows) },
    async insertFacts(rows: Fact[]) { store.facts.push(...rows) },
    async searchCompanies(query: CompanySearchQuery) { return store.companies.slice(0, query.limit) },
    async searchPeople(query: PeopleSearchQuery) { return store.people.filter((person) => query.domains.includes(person.domain)).slice(0, query.limit) },
    async listFacts(type: EntityType, ids: string[]) { return store.facts.filter((fact) => fact.entityType === type && ids.includes(fact.entityId)) },
    async insertSuppression(entries: SuppressionEntry[]) { store.suppression.push(...entries) },
    async findSuppressed(kind: SuppressionKind, hashes: string[]) {
      return new Set(store.suppression.filter((entry) => entry.kind === kind && hashes.includes(entry.valueHash)).map((entry) => entry.valueHash))
    },
  }
}
