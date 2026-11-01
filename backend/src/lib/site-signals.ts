// Deterministic signals read from a page's raw HTML: no extra requests, no model call.
import { load, type CheerioAPI } from 'cheerio'
import type { AgencyCredit, JobBoardLink, JobBoardProvider, PageSignals, StructuredOrganization, TechnologyName } from '../types/index.js'
import { normalizeCountry } from './countries.js'

const TECHNOLOGY_PATTERNS: [TechnologyName, RegExp][] = [
  ['google_analytics', /google-analytics\.com\/(analytics|ga)\.js|gtag\/js\?id=G-/i],
  ['google_tag_manager', /googletagmanager\.com\/gtm\.js/i],
  ['google_ads', /googleadservices\.com\/pagead\/conversion|gtag\/js\?id=AW-|['"]AW-\d{6,}/i],
  ['meta_pixel', /connect\.facebook\.net\/[^"']*\/fbevents\.js|fbq\(\s*['"]init/i],
  ['linkedin_insight', /snap\.licdn\.com\/li\.lms-analytics|_linkedin_partner_id/i],
  ['hubspot', /js(-eu1)?\.hs-scripts\.com|js\.hsforms\.net|js\.hs-analytics\.net/i],
  ['salesforce_pardot', /pi\.pardot\.com|pardot\.com\/pd\.js/i],
  ['marketo', /munchkin\.marketo\.net/i],
  ['segment', /cdn\.segment\.com\/analytics\.js/i],
  ['hotjar', /static\.hotjar\.com/i],
  ['intercom', /widget\.intercom\.io|js\.intercomcdn\.com/i],
  ['zendesk', /static\.zdassets\.com|zopim\.com/i],
  ['drift', /js\.driftt\.com/i],
  ['calendly', /assets\.calendly\.com|calendly\.com\/[a-z0-9_-]+/i],
  ['stripe', /js\.stripe\.com/i],
  ['shopify', /cdn\.shopify\.com|Shopify\.theme/i],
  ['woocommerce', /woocommerce/i],
  ['wordpress', /\/wp-content\/|\/wp-includes\//i],
  ['wix', /static\.wixstatic\.com|wix-code-sdk/i],
  ['squarespace', /static1\.squarespace\.com/i],
  ['webflow', /assets\.website-files\.com|data-wf-page/i],
  ['nextjs', /\/_next\/static\//],
]

export function detectTechnologies(html: string): TechnologyName[] {
  return TECHNOLOGY_PATTERNS.filter(([, pattern]) => pattern.test(html)).map(([name]) => name)
}

const ORGANIZATION_TYPES = /^(Organization|Corporation|LocalBusiness|ProfessionalService|Store|Restaurant|MedicalBusiness|LegalService|RealEstateAgent|HomeAndConstructionBusiness|FinancialService|AutomotiveBusiness|EducationalOrganization|NGO|OnlineBusiness)$/

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
type JsonObject = { [key: string]: JsonValue }

const isObject = (value: JsonValue | undefined): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: JsonValue | undefined): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined)

// JSON-LD may be a single node, an array, or { "@graph": [...] }.
function flattenNodes(value: JsonValue): JsonObject[] {
  if (Array.isArray(value)) return value.flatMap(flattenNodes)
  if (!isObject(value)) return []
  const graph = value['@graph']
  return [value, ...(graph === undefined ? [] : flattenNodes(graph))]
}

function hasOrganizationType(node: JsonObject): boolean {
  const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']]
  return types.some((type) => typeof type === 'string' && ORGANIZATION_TYPES.test(type))
}

function toOrganization(node: JsonObject): StructuredOrganization {
  const address = Array.isArray(node.address) ? node.address[0] : node.address
  const place = isObject(address) ? address : {}
  const countryValue = isObject(place.addressCountry) ? place.addressCountry.name : place.addressCountry
  const country = text(countryValue)
  return {
    name: text(node.name), legalName: text(node.legalName), telephone: text(node.telephone),
    country: country ? normalizeCountry(country) : undefined, region: text(place.addressRegion),
    city: text(place.addressLocality), foundingDate: text(node.foundingDate),
  }
}

function parseJsonLd(raw: string): JsonValue | undefined {
  try {
    return JSON.parse(raw) as JsonValue
  } catch {
    // Sites ship broken JSON-LD often; a block that doesn't parse is simply not a signal.
    return undefined
  }
}

export function readOrganization($: CheerioAPI): { organization?: StructuredOrganization; hasStructuredData: boolean } {
  const blocks = $('script[type="application/ld+json"]').map((_, el) => $(el).text()).get()
  const nodes = blocks.flatMap((raw) => {
    const parsed = parseJsonLd(raw)
    return parsed === undefined ? [] : flattenNodes(parsed)
  })
  const organization = nodes.find(hasOrganizationType)
  return { hasStructuredData: nodes.length > 0, ...(organization ? { organization: toOrganization(organization) } : {}) }
}

// Only wording that credits the site's design or build. Ownership and platform lines ("operated by",
// "a part of", "powered by") are not agency credits: a wrong incumbent in an email is worse than none.
const EXPLICIT_CREDIT = /\b(website|site|web\s*site|web design|website design|designed|developed|built|made|crafted|design and development|design & development)\s+(and\s+\w+\s+)?by\s*:?\s*$/i
const NOT_A_CREDIT = /\b(operated|owned|published|part of|powered|hosted|licensed|sponsored|supported|brought to you)\b/i
// Credits to platforms are not agencies.
const PLATFORM_CREDIT = /^(wordpress|shopify|wix|squarespace|webflow|godaddy|weebly|jimdo|hubspot|ghost|framer)$/i
const AGENCY_CONFIDENCE = 0.9

function isCredit(precedingText: string): boolean {
  const lastClause = precedingText.split(/[.|·•©]/).pop() ?? ''
  return EXPLICIT_CREDIT.test(lastClause.trim()) && !NOT_A_CREDIT.test(lastClause)
}

// A footer link credited with explicit design/build wording ("Website by …"). Anything weaker is not recorded.
export function findAgencyCredit($: CheerioAPI, pageUrl: string): AgencyCredit | undefined {
  const pageHost = new URL(pageUrl).hostname.replace(/^www\./, '')
  for (const element of $('footer a[href], [class*="footer"] a[href], [id*="footer"] a[href]').toArray()) {
    const link = $(element)
    const name = link.text().replace(/\s+/g, ' ').trim()
    const href = link.attr('href') ?? ''
    if (!name || name.length > 60 || PLATFORM_CREDIT.test(name) || !URL.canParse(href, pageUrl)) continue
    const target = new URL(href, pageUrl)
    if (target.hostname.replace(/^www\./, '') === pageHost) continue
    const preceding = (link.parent().text().split(name)[0] ?? '').replace(/\s+/g, ' ').trim()
    if (isCredit(preceding)) return { name, url: target.origin, confidence: AGENCY_CONFIDENCE }
  }
  return undefined
}

const JOB_BOARDS: [JobBoardProvider, RegExp][] = [
  ['greenhouse', /^https?:\/\/(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/([a-z0-9_-]+)/i],
  ['lever', /^https?:\/\/jobs\.(?:eu\.)?lever\.co\/([a-z0-9_.-]+)/i],
  ['ashby', /^https?:\/\/jobs\.ashbyhq\.com\/([a-z0-9_.%-]+)/i],
  ['workable', /^https?:\/\/apply\.workable\.com\/([a-z0-9_-]+)/i],
]

export function findJobBoards(links: string[]): JobBoardLink[] {
  const found = new Map<string, JobBoardLink>()
  for (const url of links) {
    for (const [provider, pattern] of JOB_BOARDS) {
      const board = pattern.exec(url)?.[1]?.toLowerCase()
      if (board && board !== 'embed' && !found.has(`${provider}:${board}`)) found.set(`${provider}:${board}`, { provider, board, url })
    }
  }
  return [...found.values()]
}

export function readPageSignals(html: string, pageUrl: string, links: string[]): PageSignals {
  const $ = load(html)
  const { organization, hasStructuredData } = readOrganization($)
  const agency = findAgencyCredit($, pageUrl)
  return {
    technologies: detectTechnologies(html),
    hasStructuredData,
    ...(organization ? { organization } : {}),
    ...(agency ? { agency } : {}),
    jobBoards: findJobBoards(links),
  }
}
