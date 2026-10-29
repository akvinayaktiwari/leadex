import type { ClickHouseClient } from '@clickhouse/client'
import type {
  CompanyRecord,
  CompanySearchQuery,
  EmployeeBand,
  EntityType,
  Fact,
  LeadDataRepository,
  PeopleSearchQuery,
  PersonRecord,
  SuppressionEntry,
  SuppressionKind,
} from '../types/index.js'

interface CompanyRow {
  company_id: string
  domain: string
  name: string
  legal_name: string
  lei: string
  description: string
  industry: string
  keywords: string[]
  employee_band: string
  country: string
  region: string
  city: string
  technologies: string[]
  served_markets: string[]
  updated_at: string
}

interface PersonRow {
  person_key: string
  domain: string
  first_name: string
  last_name: string
  title: string
  seniority: string
  department: string
  country: string
  is_officer: number
  updated_at: string
}

interface FactRow {
  entity_type: string
  entity_id: string
  field: string
  value: string
  source: string
  source_url: string
  method: string
  licence_scope: string
  retrieved_at: string
}

const EMPLOYEE_BANDS: ReadonlySet<string> = new Set<EmployeeBand>(['1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5001+'])

const COMPANY_COLUMNS = 'company_id, domain, name, legal_name, lei, description, industry, keywords, employee_band, country, region, city, technologies, served_markets, updated_at'
const PERSON_COLUMNS = 'person_key, domain, first_name, last_name, title, seniority, department, country, is_officer, updated_at'
const FACT_COLUMNS = 'entity_type, entity_id, field, value, source, source_url, method, licence_scope, retrieved_at'

// ClickHouse returns DateTime('UTC') as "YYYY-MM-DD hh:mm:ss".
function toIso(value: string): string {
  return new Date(`${value.replace(' ', 'T')}Z`).toISOString()
}

function optional(value: string): string | undefined {
  return value === '' ? undefined : value
}

function toBand(value: string): EmployeeBand | undefined {
  return EMPLOYEE_BANDS.has(value) ? (value as EmployeeBand) : undefined
}

function toCompanyRow(company: CompanyRecord): CompanyRow {
  return {
    company_id: company.companyId,
    domain: company.domain,
    name: company.name,
    legal_name: company.legalName ?? '',
    lei: company.lei ?? '',
    description: company.description ?? '',
    industry: company.industry ?? '',
    keywords: company.keywords,
    employee_band: company.employeeBand ?? '',
    country: company.country,
    region: company.region ?? '',
    city: company.city ?? '',
    technologies: company.technologies,
    served_markets: company.servedMarkets,
    updated_at: company.updatedAt,
  }
}

function fromCompanyRow(row: CompanyRow): CompanyRecord {
  return {
    companyId: row.company_id,
    domain: row.domain,
    name: row.name,
    legalName: optional(row.legal_name),
    lei: optional(row.lei),
    description: optional(row.description),
    industry: optional(row.industry),
    keywords: row.keywords,
    employeeBand: toBand(row.employee_band),
    country: row.country,
    region: optional(row.region),
    city: optional(row.city),
    technologies: row.technologies,
    servedMarkets: row.served_markets,
    updatedAt: toIso(row.updated_at),
  }
}

function toPersonRow(person: PersonRecord): PersonRow {
  return {
    person_key: person.personKey,
    domain: person.domain,
    first_name: person.firstName,
    last_name: person.lastName,
    title: person.title,
    seniority: person.seniority ?? '',
    department: person.department ?? '',
    country: person.country,
    is_officer: person.isOfficer ? 1 : 0,
    updated_at: person.updatedAt,
  }
}

function fromPersonRow(row: PersonRow): PersonRecord {
  return {
    personKey: row.person_key,
    domain: row.domain,
    firstName: row.first_name,
    lastName: row.last_name,
    title: row.title,
    seniority: optional(row.seniority),
    department: optional(row.department),
    country: row.country,
    isOfficer: row.is_officer === 1,
    updatedAt: toIso(row.updated_at),
  }
}

function toFactRow(fact: Fact): FactRow {
  return {
    entity_type: fact.entityType,
    entity_id: fact.entityId,
    field: fact.field,
    value: fact.value,
    source: fact.source,
    source_url: fact.sourceUrl,
    method: fact.method,
    licence_scope: fact.licenceScope,
    retrieved_at: fact.retrievedAt,
  }
}

// Fact rows are only ever written by this repository from typed Facts, so the stored strings are trusted here.
function fromFactRow(row: FactRow): Fact {
  return {
    entityType: row.entity_type as EntityType,
    entityId: row.entity_id,
    field: row.field,
    value: row.value,
    source: row.source as Fact['source'],
    sourceUrl: row.source_url,
    method: row.method as Fact['method'],
    licenceScope: row.licence_scope as Fact['licenceScope'],
    retrievedAt: toIso(row.retrieved_at),
  }
}

const SEARCH_COMPANIES_SQL = `
  SELECT ${COMPANY_COLUMNS} FROM companies FINAL
  WHERE country NOT IN {excluded:Array(String)}
    AND (length({countries:Array(String)}) = 0 OR country IN {countries:Array(String)})
    AND (length({industries:Array(String)}) = 0 OR industry IN {industries:Array(String)})
    AND (length({bands:Array(String)}) = 0 OR employee_band IN {bands:Array(String)})
    AND (length({keywords:Array(String)}) = 0 OR hasAny(arrayMap(k -> lower(k), keywords), {keywords:Array(String)}))
    AND (length({technologies:Array(String)}) = 0 OR hasAny(arrayMap(t -> lower(t), technologies), {technologies:Array(String)}))
  ORDER BY updated_at DESC, domain
  LIMIT {limit:UInt32}`

const SEARCH_PEOPLE_SQL = `
  SELECT ${PERSON_COLUMNS} FROM people FINAL
  WHERE domain IN {domains:Array(String)}
    AND country NOT IN {excluded:Array(String)}
    AND (length({terms:Array(String)}) = 0 OR multiSearchAnyCaseInsensitive(title, {terms:Array(String)}))
  ORDER BY domain, is_officer DESC, last_name, first_name
  LIMIT {limit:UInt32}`

async function selectRows<T>(client: ClickHouseClient, query: string, params: Record<string, unknown>): Promise<T[]> {
  const result = await client.query({ query, query_params: params, format: 'JSONEachRow' })
  return result.json<T>()
}

async function insertRows(client: ClickHouseClient, table: string, values: object[]): Promise<void> {
  if (values.length === 0) return
  await client.insert({ table, values, format: 'JSONEachRow' })
}

function searchMethods(client: ClickHouseClient): Pick<LeadDataRepository, 'searchCompanies' | 'searchPeople' | 'listFacts'> {
  return {
    async searchCompanies(query: CompanySearchQuery): Promise<CompanyRecord[]> {
      const rows = await selectRows<CompanyRow>(client, SEARCH_COMPANIES_SQL, {
        excluded: query.excludedCountries, countries: query.countries, industries: query.industries,
        bands: query.employeeBands, keywords: query.keywords, technologies: query.technologies, limit: query.limit,
      })
      return rows.map(fromCompanyRow)
    },
    async searchPeople(query: PeopleSearchQuery): Promise<PersonRecord[]> {
      if (query.domains.length === 0) return []
      const rows = await selectRows<PersonRow>(client, SEARCH_PEOPLE_SQL, {
        domains: query.domains, excluded: query.excludedCountries, terms: query.titleTerms, limit: query.limit,
      })
      return rows.map(fromPersonRow)
    },
    async listFacts(entityType: EntityType, entityIds: string[]): Promise<Fact[]> {
      if (entityIds.length === 0) return []
      const rows = await selectRows<FactRow>(client,
        `SELECT ${FACT_COLUMNS} FROM facts WHERE entity_type = {type:String} AND entity_id IN {ids:Array(String)} ORDER BY entity_id, field, retrieved_at`,
        { type: entityType, ids: entityIds })
      return rows.map(fromFactRow)
    },
  }
}

function suppressionMethods(client: ClickHouseClient): Pick<LeadDataRepository, 'insertSuppression' | 'findSuppressed'> {
  return {
    async insertSuppression(entries: SuppressionEntry[]): Promise<void> {
      await insertRows(client, 'suppression', entries.map((entry) => ({
        kind: entry.kind, value_hash: entry.valueHash, reason: entry.reason, created_at: entry.createdAt,
      })))
    },
    async findSuppressed(kind: SuppressionKind, valueHashes: string[]): Promise<Set<string>> {
      if (valueHashes.length === 0) return new Set()
      const rows = await selectRows<{ value_hash: string }>(client,
        'SELECT DISTINCT value_hash FROM suppression FINAL WHERE kind = {kind:String} AND value_hash IN {hashes:Array(String)}',
        { kind, hashes: valueHashes })
      return new Set(rows.map((row) => row.value_hash))
    },
  }
}

export function createLeadDataRepository(client: ClickHouseClient): LeadDataRepository {
  return {
    insertCompanies: (companies) => insertRows(client, 'companies', companies.map(toCompanyRow)),
    insertPeople: (people) => insertRows(client, 'people', people.map(toPersonRow)),
    insertFacts: (facts) => insertRows(client, 'facts', facts.map(toFactRow)),
    ...searchMethods(client),
    ...suppressionMethods(client),
  }
}
