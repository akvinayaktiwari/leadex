// The one way to build the crawler's fetch repository, shared by the worker and the ingest task.
import { isPublicAddress } from './lib/address-policy.js'
import { createSiteFetchRepository } from './repositories/site-fetch-repository.js'
import type { SiteFetchRepository } from './types/index.js'

const MAX_PAGE_BYTES = 3_000_000
const MAX_REDIRECTS = 4

export function crawlerUserAgent(frontendUrl: string): string {
  return `LeadexBot/1.0 (+${new URL('/bot', frontendUrl).href})`
}

export function createCrawlerSiteFetch(frontendUrl: string): SiteFetchRepository {
  return createSiteFetchRepository({ userAgent: crawlerUserAgent(frontendUrl), maxBytes: MAX_PAGE_BYTES, maxRedirects: MAX_REDIRECTS, isAllowedAddress: isPublicAddress })
}
