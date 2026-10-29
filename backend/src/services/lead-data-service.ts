// Leadex Data rules on top of the ClickHouse repository: provenance for every claimed field,
// no EU/EEA/UK or unknown-country records, and suppression checked on every write and read.
import { BLOCKED_COUNTRIES, isAllowedCountry, normalizeCountry } from '../lib/countries.js'
import { employeeBandsBetween } from '../lib/employee-bands.js'
import { companyIdFor, normalizeLeadDomain, personKeyFor, suppressionHash } from '../lib/lead-keys.js'
import type {
  Clock,
  CompanyFilters,
  CompanyRecord,
  CompanyWrite,
  DeliverableCompany,
  DeliverablePerson,
  EntityType,
  Fact,
  FactInput,
  LeadDataRepository,
  LeadDataService,
  PersonRecord,
  PersonWrite,
  SuppressionKind,
  SuppressionReason,
  WriteOutcome,
} from '../types/index.js'
import { assertAllowedCountry, assertPresent, assertProvenance, populatedFields } from './lead-data-rules.js'

export interface LeadDataServiceDeps {
  repository: LeadDataRepository
  clock: Clock
}

const COMPANY_DERIVED = ['companyId', 'updatedAt'] as const
const PERSON_DERIVED = ['personKey', 'updatedAt'] as const
const MAX_LIMIT = 1000

function clampLimit(limit: number): number {
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)))
}

function toFacts(entityType: EntityType, entityId: string, inputs: FactInput[]): Fact[] {
  return inputs.map((input) => ({ ...input, entityType, entityId }))
}

function buildCompany(write: CompanyWrite, updatedAt: string): CompanyRecord {
  const domain = normalizeLeadDomain(write.company.domain)
  const country = normalizeCountry(write.company.country) ?? write.company.country
  return { ...write.company, domain, country, companyId: companyIdFor(domain), updatedAt }
}

function buildPerson(write: PersonWrite, updatedAt: string): PersonRecord {
  const { firstName, lastName } = write.person
  const domain = normalizeLeadDomain(write.person.domain)
  const country = normalizeCountry(write.person.country) ?? write.person.country
  return { ...write.person, domain, country, personKey: personKeyFor(firstName, lastName, domain), updatedAt }
}

async function isSuppressed(repository: LeadDataRepository, kind: SuppressionKind, values: string[]): Promise<boolean> {
  const hashes = values.map((value) => suppressionHash(kind, value))
  return (await repository.findSuppressed(kind, hashes)).size > 0
}

function createWriteMethods(deps: LeadDataServiceDeps): Pick<LeadDataService, 'saveCompany' | 'savePerson'> {
  const { repository, clock } = deps
  return {
    async saveCompany(write: CompanyWrite): Promise<WriteOutcome> {
      const company = buildCompany(write, clock.now().toISOString())
      assertPresent(`Company ${company.domain}`, { domain: company.domain, name: company.name })
      assertAllowedCountry(`Company ${company.domain}`, company.country)
      assertProvenance(`Company ${company.domain}`, populatedFields({ ...company }, COMPANY_DERIVED), write.facts.map((fact) => fact.field))
      if (await isSuppressed(repository, 'domain', [company.domain])) return { status: 'suppressed', entityId: company.companyId }
      // Facts first: a crash between the two writes leaves unused facts, never an unsourced record.
      await repository.insertFacts(toFacts('company', company.companyId, write.facts))
      await repository.insertCompanies([company])
      return { status: 'saved', entityId: company.companyId }
    },
    async savePerson(write: PersonWrite): Promise<WriteOutcome> {
      const person = buildPerson(write, clock.now().toISOString())
      const label = `Person at ${person.domain}`
      assertPresent(label, { domain: person.domain, firstName: person.firstName, lastName: person.lastName, title: person.title })
      assertAllowedCountry(label, person.country)
      assertProvenance(label, populatedFields({ ...person }, PERSON_DERIVED), write.facts.map((fact) => fact.field))
      const suppressed = (await isSuppressed(repository, 'person', [person.personKey])) || (await isSuppressed(repository, 'domain', [person.domain]))
      if (suppressed) return { status: 'suppressed', entityId: person.personKey }
      await repository.insertFacts(toFacts('person', person.personKey, write.facts))
      await repository.insertPeople([person])
      return { status: 'saved', entityId: person.personKey }
    },
  }
}

// Countries the caller asked for, minus blocked ones. `undefined` means the request named only blocked
// countries, so nothing may be returned (an empty list would mean "any country").
function allowedCountries(requested: string[]): string[] | undefined {
  const normalized = requested.map((code) => normalizeCountry(code)).filter((code): code is string => code !== undefined)
  const allowed = normalized.filter((code) => isAllowedCountry(code))
  return requested.length > 0 && allowed.length === 0 ? undefined : allowed
}

async function dropSuppressedDomains<T extends { domain: string }>(repository: LeadDataRepository, rows: T[]): Promise<T[]> {
  const hashes = new Map(rows.map((row) => [row, suppressionHash('domain', row.domain)] as const))
  const suppressed = await repository.findSuppressed('domain', [...new Set(hashes.values())])
  return rows.filter((row) => !suppressed.has(hashes.get(row) ?? ''))
}

async function dropSuppressedPeople(repository: LeadDataRepository, people: PersonRecord[]): Promise<PersonRecord[]> {
  const byHash = new Map(people.map((person) => [suppressionHash('person', person.personKey), person] as const))
  const suppressed = await repository.findSuppressed('person', [...byHash.keys()])
  return dropSuppressedDomains(repository, [...byHash].filter(([hash]) => !suppressed.has(hash)).map(([, person]) => person))
}

function createSearchMethods(deps: LeadDataServiceDeps): Pick<LeadDataService, 'findCompanies' | 'findPeople'> {
  const { repository } = deps
  return {
    async findCompanies(filters: CompanyFilters, limit: number): Promise<CompanyRecord[]> {
      const countries = allowedCountries(filters.countries)
      if (!countries) return []
      const rows = await repository.searchCompanies({
        countries, excludedCountries: [...BLOCKED_COUNTRIES], industries: filters.industries,
        employeeBands: employeeBandsBetween(filters.employeeMin, filters.employeeMax),
        keywords: filters.keywords.map((keyword) => keyword.toLowerCase()),
        technologies: filters.technologies.map((technology) => technology.toLowerCase()),
        limit: clampLimit(limit),
      })
      // The query already excludes blocked countries; this second check keeps the rule if the SQL ever changes.
      return dropSuppressedDomains(repository, rows.filter((row) => isAllowedCountry(row.country)))
    },
    async findPeople(domains: string[], titleTerms: string[], limit: number): Promise<PersonRecord[]> {
      const rows = await repository.searchPeople({
        domains: [...new Set(domains.map(normalizeLeadDomain))], excludedCountries: [...BLOCKED_COUNTRIES],
        titleTerms: titleTerms.map((term) => term.trim()).filter((term) => term.length > 0), limit: clampLimit(limit),
      })
      return dropSuppressedPeople(repository, rows.filter((row) => isAllowedCountry(row.country)))
    },
  }
}

function groupFacts(facts: Fact[]): Map<string, Fact[]> {
  const grouped = new Map<string, Fact[]>()
  for (const fact of facts) grouped.set(fact.entityId, [...(grouped.get(fact.entityId) ?? []), fact])
  return grouped
}

function createDeliveryMethods(deps: LeadDataServiceDeps): Pick<LeadDataService, 'loadDeliverableCompanies' | 'loadDeliverablePeople'> {
  const { repository } = deps
  return {
    async loadDeliverableCompanies(companies: CompanyRecord[]): Promise<DeliverableCompany[]> {
      const facts = groupFacts(await repository.listFacts('company', companies.map((company) => company.companyId)))
      return companies.map((company) => {
        const own = facts.get(company.companyId) ?? []
        assertAllowedCountry(`Company ${company.domain}`, company.country)
        assertProvenance(`Company ${company.domain}`, populatedFields({ ...company }, COMPANY_DERIVED), own.map((fact) => fact.field))
        return { company, facts: own }
      })
    },
    async loadDeliverablePeople(people: PersonRecord[]): Promise<DeliverablePerson[]> {
      const facts = groupFacts(await repository.listFacts('person', people.map((person) => person.personKey)))
      return people.map((person) => {
        const own = facts.get(person.personKey) ?? []
        assertAllowedCountry(`Person at ${person.domain}`, person.country)
        assertProvenance(`Person at ${person.domain}`, populatedFields({ ...person }, PERSON_DERIVED), own.map((fact) => fact.field))
        return { person, facts: own }
      })
    },
  }
}

export function createLeadDataService(deps: LeadDataServiceDeps): LeadDataService {
  return {
    ...createWriteMethods(deps),
    ...createSearchMethods(deps),
    ...createDeliveryMethods(deps),
    async suppress(kind: SuppressionKind, value: string, reason: SuppressionReason): Promise<void> {
      const createdAt = deps.clock.now().toISOString()
      await deps.repository.insertSuppression([{ kind, valueHash: suppressionHash(kind, value), reason, createdAt }])
    },
  }
}
