import { isSameSite, normalizeDomain } from '../../lib/domain.js'
import { PipelineError } from '../../lib/errors.js'
import { extractPage } from '../../lib/html-text.js'
import { ALLOW_ALL, isPathAllowed, parseRobots, type RobotsPolicy } from '../../lib/robots.js'
import type { AnalysisState, Clock, CrawledPage, CrawledSite, PipelineStep, SiteFetchRepository, StepContext } from '../../types/index.js'

export const CRAWLER_AGENT_TOKEN = 'leadexbot'
const MAX_EXTRA_PAGES = 10
// Keeps one section (e.g. 20 case studies under /work/) from filling every slot.
const MAX_PAGES_PER_SECTION = 3
const MAX_TOTAL_TEXT_CHARS = 2_000_000
const CRAWL_BUDGET_MS = 8_000
const PAGE_TIMEOUT_MS = 5_000
const ROBOTS_TIMEOUT_MS = 3_000
const MIN_REMAINING_MS = 500
// Below this the site is almost certainly rendered by JavaScript or empty.
const MIN_SITE_TEXT_CHARS = 200

// Pages that say the most about what a business sells and to whom, best first.
const PRIORITY_PATHS: RegExp[] = [
  /pricing|plans/, /about|company|who-we-are/, /product|platform|features/, /solutions|use-cases|industries/,
  /services|what-we-do/, /customers|case-stud|clients|work|portfolio/, /contact/,
]
const SKIP_EXTENSIONS = /\.(pdf|png|jpe?g|gif|svg|webp|ico|zip|mp4|mp3|css|js|xml|json|txt)$/i

export interface CrawlStepDeps {
  siteFetch: SiteFetchRepository
  clock: Clock
}

interface Homepage {
  origin: string
  robots: RobotsPolicy
  page: CrawledPage
  links: string[]
}

async function loadRobots(deps: CrawlStepDeps, origin: string): Promise<RobotsPolicy> {
  const result = await deps.siteFetch.fetchText({ url: `${origin}/robots.txt`, accept: 'text', timeoutMs: ROBOTS_TIMEOUT_MS })
  // No robots.txt (or an unreadable one) means no restrictions.
  return result.ok ? parseRobots(result.body) : ALLOW_ALL
}

function toPage(url: string, html: string): { page: CrawledPage; links: string[] } {
  const extracted = extractPage(html, url)
  const page: CrawledPage = { url, path: new URL(url).pathname, title: extracted.title, description: extracted.description, text: extracted.text }
  return { page, links: extracted.links }
}

async function fetchHomepage(deps: CrawlStepDeps, domain: string): Promise<Homepage> {
  for (const candidate of [`https://${domain}`, `https://www.${domain}`]) {
    const robots = await loadRobots(deps, candidate)
    if (!isPathAllowed(robots, CRAWLER_AGENT_TOKEN, '/')) throw new PipelineError('robots_disallowed', `${domain} asks crawlers not to read its pages`)
    const result = await deps.siteFetch.fetchText({ url: `${candidate}/`, accept: 'html', timeoutMs: PAGE_TIMEOUT_MS })
    if (!result.ok) continue
    const finalUrl = new URL(result.finalUrl)
    const finalRobots = finalUrl.origin === candidate ? robots : await loadRobots(deps, finalUrl.origin)
    if (!isPathAllowed(finalRobots, CRAWLER_AGENT_TOKEN, finalUrl.pathname)) throw new PipelineError('robots_disallowed', `${domain} asks crawlers not to read its pages`)
    return { origin: finalUrl.origin, robots: finalRobots, ...toPage(result.finalUrl, result.body) }
  }
  throw new PipelineError('site_unreachable', `We could not load ${domain}. Check the address and try again.`)
}

function priorityOf(path: string): number {
  const index = PRIORITY_PATHS.findIndex((pattern) => pattern.test(path.toLowerCase()))
  return index === -1 ? PRIORITY_PATHS.length : index
}

// Same-site, robots-allowed content pages, one per path, highest priority first, nav order as tiebreak.
function selectPages(homepage: Homepage): { urls: string[]; blockedByRobots: number } {
  const host = new URL(homepage.origin).hostname
  const byPath = new Map<string, string>()
  let blockedByRobots = 0
  for (const link of homepage.links) {
    const url = new URL(link)
    const path = url.pathname.replace(/\/+$/, '') || '/'
    if (!isSameSite(url.hostname, host) || path === '/' || SKIP_EXTENSIONS.test(path) || byPath.has(path)) continue
    if (!isPathAllowed(homepage.robots, CRAWLER_AGENT_TOKEN, url.pathname)) {
      blockedByRobots += 1
      continue
    }
    byPath.set(path, `${homepage.origin}${url.pathname}`)
  }
  const ranked = [...byPath.entries()].map(([path, url], order) => ({ url, order, rank: priorityOf(path) }))
  ranked.sort((a, b) => a.rank - b.rank || a.order - b.order)
  return { urls: takeAcrossSections(ranked.map((entry) => entry.url)), blockedByRobots }
}

function takeAcrossSections(urls: string[]): string[] {
  const perSection = new Map<string, number>()
  const taken: string[] = []
  for (const url of urls) {
    const section = new URL(url).pathname.split('/')[1] ?? ''
    const count = perSection.get(section) ?? 0
    if (count >= MAX_PAGES_PER_SECTION) continue
    perSection.set(section, count + 1)
    taken.push(url)
    if (taken.length === MAX_EXTRA_PAGES) break
  }
  return taken
}

async function fetchPages(deps: CrawlStepDeps, urls: string[], deadline: number): Promise<{ pages: CrawledPage[]; failed: number }> {
  const remaining = deadline - deps.clock.now().getTime()
  if (remaining < MIN_REMAINING_MS || urls.length === 0) return { pages: [], failed: urls.length }
  const timeoutMs = Math.min(PAGE_TIMEOUT_MS, remaining)
  const results = await Promise.all(urls.map((url) => deps.siteFetch.fetchText({ url, accept: 'html', timeoutMs })))
  const pages = results.flatMap((result) => (result.ok ? [toPage(result.finalUrl, result.body).page] : []))
  return { pages, failed: results.length - pages.length }
}

function capText(pages: CrawledPage[]): CrawledPage[] {
  let total = 0
  const kept: CrawledPage[] = []
  for (const page of pages) {
    if (total >= MAX_TOTAL_TEXT_CHARS) break
    const text = page.text.slice(0, MAX_TOTAL_TEXT_CHARS - total)
    total += text.length
    kept.push({ ...page, text })
  }
  return kept
}

async function crawl(deps: CrawlStepDeps, domain: string): Promise<CrawledSite> {
  const deadline = deps.clock.now().getTime() + CRAWL_BUDGET_MS
  const homepage = await fetchHomepage(deps, domain)
  const selection = selectPages(homepage)
  const extra = await fetchPages(deps, selection.urls, deadline)
  const pages = capText([homepage.page, ...extra.pages])
  return { domain, origin: homepage.origin, pages, blockedByRobots: selection.blockedByRobots, failedPages: extra.failed }
}

async function execute(deps: CrawlStepDeps, state: AnalysisState, context: StepContext): Promise<void> {
  const normalized = normalizeDomain(context.run.domain)
  if (!normalized.ok) throw new PipelineError('invalid_url', 'That does not look like a public website address')
  const site = await crawl(deps, normalized.domain)
  const textChars = site.pages.reduce((sum, page) => sum + page.text.length, 0)
  if (textChars < MIN_SITE_TEXT_CHARS) {
    throw new PipelineError('site_unreadable', `${site.domain} has almost no readable text. It may need JavaScript to show its content.`)
  }
  state.site = site
  const skipped = site.blockedByRobots > 0 ? `, skipped ${site.blockedByRobots} that robots.txt asks us not to read` : ''
  await context.emit({ kind: 'agent_note', text: `Read ${site.pages.length} pages from ${site.domain}${skipped}` })
}

export function createCrawlStep(deps: CrawlStepDeps, state: AnalysisState): PipelineStep {
  return { id: 'crawl', label: 'Reading the website', execute: (context) => execute(deps, state, context) }
}
