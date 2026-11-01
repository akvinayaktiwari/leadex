// Which domains from the Common Crawl graph are worth profiling as companies.

// ccTLDs of EU/EEA/UK countries, plus .eu. A ccTLD is not proof of location, but v1 skips these up front
// instead of crawling sites whose companies it could never store.
const BLOCKED_TLDS = new Set([
  'at', 'be', 'bg', 'hr', 'cy', 'cz', 'dk', 'ee', 'fi', 'fr', 'de', 'gr', 'hu', 'ie', 'it', 'lv', 'lt', 'lu',
  'mt', 'nl', 'pl', 'pt', 'ro', 'sk', 'si', 'es', 'se', 'is', 'li', 'no', 'uk', 'gb', 'eu',
])

// Government, education and military suffixes: never companies.
const NON_COMPANY_TLDS = new Set(['gov', 'edu', 'mil', 'int'])
const NON_COMPANY_SECOND_LEVEL = new Set(['gov', 'gob', 'gouv', 'go', 'govt', 'nic', 'mil', 'edu', 'ac', 'sch', 'res'])

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/

export type DomainRejection = 'invalid' | 'blocked_tld' | 'non_company'

// "com.example" → "example.com"; "uk.co.bbc" → "bbc.co.uk".
export function unreverseDomain(reversed: string): string {
  return reversed.trim().toLowerCase().split('.').reverse().join('.')
}

export function tldOf(domain: string): string {
  return domain.slice(domain.lastIndexOf('.') + 1)
}

export function rejectDomain(domain: string): DomainRejection | undefined {
  const labels = domain.split('.')
  if (labels.length < 2 || domain.length > 253 || !labels.every((label) => LABEL.test(label))) return 'invalid'
  const tld = labels[labels.length - 1] ?? ''
  if (BLOCKED_TLDS.has(tld)) return 'blocked_tld'
  // e.g. gov.in, ac.in, edu.au: the label just left of a ccTLD marks a public-sector suffix.
  const secondLevel = labels.length >= 3 ? labels[labels.length - 2] ?? '' : ''
  if (NON_COMPANY_TLDS.has(tld) || (tld.length === 2 && NON_COMPANY_SECOND_LEVEL.has(secondLevel))) return 'non_company'
  return undefined
}

// ".../hyperlinkgraph/cc-main-2026-apr-may-jun/domain/..." → "cc-main-2026-apr-may-jun".
export function commonCrawlRelease(url: string): string | undefined {
  return /\/hyperlinkgraph\/(cc-main-[a-z0-9-]+)\//.exec(url)?.[1]
}
