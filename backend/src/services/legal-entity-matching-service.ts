// Matches profiled companies to GLEIF legal entities (#22 part 3): same normalized legal name, same country
// (legal address or head office), active entity, and exactly one candidate. Anything less leaves the company unmatched.
import { legalNameKey } from '../lib/legal-names.js'
import { logInfo } from '../lib/logger.js'
import type {
  Clock, CompanyRecord, FactInput, LeadDataService, LegalEntitiesRepository, LegalEntityNameRow, LegalMatchOutcome, LegalMatchSummary,
} from '../types/index.js'

export interface LegalMatchDeps {
  leadData: LeadDataService
  entities: LegalEntitiesRepository
  clock: Clock
  // Public page for one LEI, e.g. "https://search.gleif.org/#/record/"; the LEI is appended.
  recordUrlBase: string
}

// Retired registrations and inactive entities are not matched; a lapsed LEI still names a real, active entity.
const MATCHABLE_REGISTRATIONS = new Set(['ISSUED', 'LAPSED', 'PENDING_TRANSFER', 'PENDING_ARCHIVAL'])

export function candidateLeis(company: CompanyRecord, rows: LegalEntityNameRow[]): string[] {
  const key = legalNameKey(company.legalName ?? '')
  const leis = rows
    .filter((row) => row.nameKey === key && row.entityStatus === 'ACTIVE' && MATCHABLE_REGISTRATIONS.has(row.registrationStatus))
    .filter((row) => row.legalCountry === company.country || row.hqCountry === company.country)
    .map((row) => row.lei)
  return [...new Set(leis)]
}

function leiFact(deps: LegalMatchDeps, lei: string): FactInput<'lei'> {
  return { field: 'lei', value: lei, source: 'gleif', sourceUrl: `${deps.recordUrlBase}${lei}`, method: 'registry', licenceScope: 'open_data', retrievedAt: deps.clock.now().toISOString() }
}

async function matchOne(deps: LegalMatchDeps, company: CompanyRecord, rows: LegalEntityNameRow[]): Promise<LegalMatchOutcome> {
  const leis = candidateLeis(company, rows)
  if (leis.length === 0) return 'no_match'
  if (leis.length > 1) return 'ambiguous'
  const lei = leis[0] as string
  const outcome = await deps.leadData.enrichCompany({ domain: company.domain, changes: { lei }, facts: [leiFact(deps, lei)] })
  return outcome.status === 'saved' ? 'matched' : 'no_match'
}

export async function matchLegalEntities(deps: LegalMatchDeps, limit: number): Promise<LegalMatchSummary> {
  const companies = await deps.leadData.companiesWithoutLei(limit)
  const keys = [...new Set(companies.map((company) => legalNameKey(company.legalName ?? '')).filter((key) => key !== ''))]
  const rows = await deps.entities.findNames(keys)
  const summary: LegalMatchSummary = { checked: companies.length, matched: 0, noMatch: 0, ambiguous: 0 }
  for (const company of companies) {
    const outcome = await matchOne(deps, company, rows)
    if (outcome === 'matched') summary.matched += 1
    else if (outcome === 'ambiguous') summary.ambiguous += 1
    else summary.noMatch += 1
  }
  logInfo('legal entity matching finished', { ...summary })
  return summary
}
