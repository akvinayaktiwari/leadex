// Pure rules that turn a crawl, its page signals and the model's draft into a company write with provenance,
// or a reason to skip the domain. Nothing here calls a repository or a model.
import { isAllowedCountry, normalizeCountry } from '../lib/countries.js'
import { employeeBandFor } from '../lib/employee-bands.js'
import type { CompanyProfileDraft } from '../lib/schemas.js'
import type {
  CompanyField,
  CompanySignalField,
  CompanyWrite,
  CrawledPage,
  CrawledSite,
  FactInput,
  FactMethod,
  PageSignals,
  ProfileSkipReason,
  StructuredOrganization,
  TechnologyName,
} from '../types/index.js'

type Field = CompanyField | CompanySignalField
type Fact = FactInput<Field>

export type ProfileDecision = { ok: true; write: CompanyWrite } | { ok: false; reason: ProfileSkipReason }

interface Location {
  country: string
  region?: string | undefined
  city?: string | undefined
  sourceUrl: string
  method: FactMethod
}

const squash = (value: string): string => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()

// A quote counts only if it really appears on the page it cites (case- and whitespace-insensitive).
export function quoteOnPage(pages: CrawledPage[], url: string, quote: string): boolean {
  const page = pages.find((candidate) => candidate.url === url)
  return page !== undefined && squash(quote).length >= 3 && squash(`${page.title} ${page.description} ${page.text}`).includes(squash(quote))
}

function factMaker(retrievedAt: string): (field: Field, value: string, sourceUrl: string, method?: FactMethod) => Fact {
  return (field, value, sourceUrl, method = 'page_extract') => ({ field, value, sourceUrl, method, source: 'website', licenceScope: 'owned', retrievedAt })
}

function structuredOrganization(site: CrawledSite): { organization: StructuredOrganization; url: string } | undefined {
  for (const page of site.pages) {
    if (page.signals?.organization) return { organization: page.signals.organization, url: page.url }
  }
  return undefined
}

// Country from the site's own schema.org markup first, then from the model only with a verified quote.
export function resolveLocation(site: CrawledSite, draft: CompanyProfileDraft): Location | undefined {
  const structured = structuredOrganization(site)
  if (structured?.organization.country) {
    const { country, region, city } = structured.organization
    return { country, region, city, sourceUrl: structured.url, method: 'structured_data' }
  }
  const { location } = draft
  const country = normalizeCountry(location.country)
  if (!country || !quoteOnPage(site.pages, location.sourceUrl, location.quote)) return undefined
  return { country, region: location.region || undefined, city: location.city || undefined, sourceUrl: location.sourceUrl, method: 'page_extract' }
}

function mergedTechnologies(site: CrawledSite): { names: TechnologyName[]; firstSeen: Map<TechnologyName, string> } {
  const firstSeen = new Map<TechnologyName, string>()
  for (const page of site.pages) {
    for (const name of page.signals?.technologies ?? []) if (!firstSeen.has(name)) firstSeen.set(name, page.url)
  }
  return { names: [...firstSeen.keys()], firstSeen }
}

function signalFacts(site: CrawledSite, make: ReturnType<typeof factMaker>): Fact[] {
  const homepage = site.pages[0]
  const facts: Fact[] = []
  const { firstSeen } = mergedTechnologies(site)
  for (const [name, url] of firstSeen) facts.push(make(`signal.tech.${name}`, 'true', url, 'structured_data'))
  if (homepage) facts.push(make('signal.structured_data', String(homepage.signals?.hasStructuredData ?? false), homepage.url, 'structured_data'))
  const agency = site.pages.map((page) => ({ page, credit: page.signals?.agency })).find((entry) => entry.credit)
  if (agency?.credit) facts.push(make('signal.agency', JSON.stringify(agency.credit), agency.page.url))
  const boards = new Map(site.pages.flatMap((page) => (page.signals?.jobBoards ?? []).map((board) => [`${board.provider}:${board.board}`, page.url] as const)))
  for (const [board, url] of boards) facts.push(make('signal.job_board', board, url))
  return facts
}

type Draft = CompanyWrite['company']

function sourcedText(pages: Set<string>, value: string, sourceUrl: string): boolean {
  return value.trim().length > 0 && pages.has(sourceUrl)
}

// Optional descriptive fields: kept only when the model cites one of the pages it was given.
function descriptiveFields(site: CrawledSite, draft: CompanyProfileDraft, make: ReturnType<typeof factMaker>): { company: Partial<Draft>; facts: Fact[] } {
  const pages = new Set(site.pages.map((page) => page.url))
  const company: Partial<Draft> = {}
  const facts: Fact[] = []
  const keep = <K extends keyof Draft & CompanyField>(field: K, value: Draft[K], factValue: string, sourceUrl: string): void => {
    company[field] = value
    facts.push(make(field, factValue, sourceUrl))
  }
  if (sourcedText(pages, draft.description.value, draft.description.sourceUrl)) keep('description', draft.description.value, draft.description.value, draft.description.sourceUrl)
  if (pages.has(draft.industry.sourceUrl)) keep('industry', draft.industry.value, draft.industry.value, draft.industry.sourceUrl)
  const keywords = [...new Set(draft.keywords.value.map((keyword) => keyword.trim().toLowerCase()).filter(Boolean))]
  if (keywords.length > 0 && pages.has(draft.keywords.sourceUrl)) keep('keywords', keywords, JSON.stringify(keywords), draft.keywords.sourceUrl)
  const markets = [...new Set(draft.servedMarkets.value)]
  const served = markets.includes('GLOBAL') ? ['GLOBAL'] : markets
  if (served.length > 0 && pages.has(draft.servedMarkets.sourceUrl)) keep('servedMarkets', served, JSON.stringify(served), draft.servedMarkets.sourceUrl)
  const { employeeCount } = draft
  const band = employeeBandFor(employeeCount.value)
  if (band && quoteOnPage(site.pages, employeeCount.sourceUrl, employeeCount.quote)) keep('employeeBand', band, employeeCount.quote, employeeCount.sourceUrl)
  return { company, facts }
}

// Name and legal name: the site's own structured data wins; otherwise the model's, if it cites a crawled page.
function identityFields(site: CrawledSite, draft: CompanyProfileDraft, make: ReturnType<typeof factMaker>): { name?: Fact; legalName?: Fact } {
  const pages = new Set(site.pages.map((page) => page.url))
  const structured = structuredOrganization(site)
  const fromModel = (value: string, url: string, field: 'name' | 'legalName'): Fact | undefined =>
    sourcedText(pages, value, url) ? make(field, value.trim(), url) : undefined
  const name = structured?.organization.name ? make('name', structured.organization.name, structured.url, 'structured_data') : fromModel(draft.name.value, draft.name.sourceUrl, 'name')
  const legalName = structured?.organization.legalName ? make('legalName', structured.organization.legalName, structured.url, 'structured_data') : fromModel(draft.legalName.value, draft.legalName.sourceUrl, 'legalName')
  return { ...(name ? { name } : {}), ...(legalName ? { legalName } : {}) }
}

function locationFacts(location: Location, make: ReturnType<typeof factMaker>): Fact[] {
  const facts = [make('country', location.country, location.sourceUrl, location.method)]
  if (location.region) facts.push(make('region', location.region, location.sourceUrl, location.method))
  if (location.city) facts.push(make('city', location.city, location.sourceUrl, location.method))
  return facts
}

export function decideCompanyProfile(site: CrawledSite, draft: CompanyProfileDraft, retrievedAt: string): ProfileDecision {
  if (!draft.isBusiness) return { ok: false, reason: 'not_a_business' }
  const location = resolveLocation(site, draft)
  if (!location) return { ok: false, reason: 'unknown_country' }
  if (!isAllowedCountry(location.country)) return { ok: false, reason: 'blocked_country' }
  const make = factMaker(retrievedAt)
  const identity = identityFields(site, draft, make)
  if (!identity.name) return { ok: false, reason: 'no_provenance' }
  const homepage = site.pages[0]?.url ?? `https://${site.domain}/`
  const descriptive = descriptiveFields(site, draft, make)
  const { names: technologies, firstSeen } = mergedTechnologies(site)
  // One fact per technology, pointing at the page where it was seen.
  const technologyFacts = [...firstSeen].map(([name, url]) => make('technologies', name, url, 'structured_data'))
  const company: Draft = {
    domain: site.domain, name: identity.name.value, legalName: identity.legalName?.value, keywords: [], technologies,
    servedMarkets: [], country: location.country, region: location.region, city: location.city, ...descriptive.company,
  }
  const facts: Fact[] = [
    make('domain', site.domain, homepage), identity.name, ...(identity.legalName ? [identity.legalName] : []),
    ...locationFacts(location, make), ...descriptive.facts, ...technologyFacts, ...signalFacts(site, make),
  ]
  return { ok: true, write: { company, facts } }
}
