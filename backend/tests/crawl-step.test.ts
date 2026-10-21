import { describe, expect, it } from 'vitest'
import { PipelineError } from '../src/lib/errors.js'
import { createCrawlStep } from '../src/services/pipeline-steps/crawl-step.js'
import type { AnalysisState, StepContext, StepEmission } from '../src/types/index.js'
import { fakeSite, html } from './support/analysis-fakes.js'
import { manualClock, sampleRun } from './support/in-memory-run-store.js'

const LONG = 'We build invoicing software for agencies. '.repeat(10)

function context(domain: string, emitted: StepEmission[] = []): StepContext {
  return { run: sampleRun({ domain }), emit: async (emission) => void emitted.push(emission) }
}

async function crawl(pages: Record<string, string>, domain = 'acme.com', redirects: Record<string, string> = {}) {
  const site = fakeSite(pages, redirects)
  const state: AnalysisState = {}
  const emitted: StepEmission[] = []
  await createCrawlStep({ siteFetch: site, clock: manualClock() }, state).execute(context(domain, emitted))
  return { site, state, emitted }
}

describe('crawl step', () => {
  // protects=the homepage plus same-site key pages are read, pricing/about ranked first, other sites and files skipped;
  // fails_when=off-site links, PDFs or the homepage itself are fetched as extra pages, or pricing is crowded out;
  // no_claim=uses fixture HTML; real-site link structures vary.
  it('reads the homepage and the most relevant same-site pages', async () => {
    const links = ['/blog/post-1', '/pricing', 'https://other.com/x', '/brochure.pdf', '/', 'https://www.acme.com/about', '/careers']
    const { state, emitted, site } = await crawl({
      'https://acme.com/': html('Acme', LONG, links),
      'https://acme.com/pricing': html('Pricing', 'Plans from INR 499'),
      'https://acme.com/about': html('About', 'Founded in Bangalore'),
      'https://acme.com/blog/post-1': html('Post', 'A post'),
      'https://acme.com/careers': html('Careers', 'Jobs'),
    })
    expect(state.site?.pages.map((page) => page.path)).toEqual(['/', '/pricing', '/about', '/blog/post-1', '/careers'])
    expect(site.requested).not.toContain('https://other.com/x')
    expect(site.requested.some((url) => url.endsWith('.pdf'))).toBe(false)
    expect(emitted).toEqual([{ kind: 'agent_note', text: 'Read 5 pages from acme.com' }])
  })

  // protects=at most 10 extra pages are fetched regardless of how many links a homepage has;
  // fails_when=a link-heavy homepage makes the crawl fetch dozens of pages and blow the 8 s budget;
  // no_claim=does not measure wall-clock time.
  it('caps extra pages at 10', async () => {
    const links = Array.from({ length: 30 }, (_, i) => `/page-${i}`)
    const pages: Record<string, string> = { 'https://acme.com/': html('Acme', LONG, links) }
    for (const link of links) pages[`https://acme.com${link}`] = html(link, 'text')
    const { state } = await crawl(pages)
    expect(state.site?.pages).toHaveLength(11)
  })

  // protects=one section can't take every slot: at most 3 pages per top-level path segment;
  // fails_when=20 case studies under /work/ crowd out /services and /contact (seen live on qdnco.com);
  // no_claim=does not decide which 3 pages of a section are best beyond link order.
  it('spreads pages across sections', async () => {
    const links = [...Array.from({ length: 8 }, (_, i) => `/work/case-${i}`), '/services', '/contact']
    const pages: Record<string, string> = { 'https://acme.com/': html('Acme', LONG, links) }
    for (const link of links) pages[`https://acme.com${link}`] = html(link, 'text')
    const { state } = await crawl(pages)
    const paths = state.site?.pages.map((page) => page.path) ?? []
    expect(paths.filter((path) => path.startsWith('/work/'))).toHaveLength(3)
    expect(paths).toEqual(expect.arrayContaining(['/services', '/contact']))
  })

  // protects=robots.txt is honoured for the homepage and for each extra page;
  // fails_when=a Disallow'd page is fetched, or a site that disallows / is crawled anyway;
  // no_claim=does not test robots fetch failures (treated as allow-all).
  it('obeys robots.txt', async () => {
    const { site, state, emitted } = await crawl({
      'https://acme.com/robots.txt': 'User-agent: *\nDisallow: /pricing',
      'https://acme.com/': html('Acme', LONG, ['/pricing', '/about']),
      'https://acme.com/about': html('About', 'About us'),
    })
    expect(site.requested).not.toContain('https://acme.com/pricing')
    expect(state.site?.blockedByRobots).toBe(1)
    expect(emitted[0]).toMatchObject({ text: expect.stringContaining('skipped 1 that robots.txt asks us not to read') })
    await expect(crawl({ 'https://acme.com/robots.txt': 'User-agent: LeadexBot\nDisallow: /', 'https://acme.com/': html('Acme', LONG) })).rejects.toMatchObject({ code: 'robots_disallowed' })
  })

  // protects=a site that only answers on www (or redirects) is still crawled, with links resolved against the final origin;
  // fails_when=the crawl gives up when the bare domain fails, or keeps fetching pages on the pre-redirect origin;
  // no_claim=does not test http-only sites.
  it('falls back to www and follows the final origin', async () => {
    const { state } = await crawl({
      'https://www.acme.com/': html('Acme', LONG, ['/pricing']),
      'https://www.acme.com/pricing': html('Pricing', 'Plans'),
    })
    expect(state.site?.origin).toBe('https://www.acme.com')
    expect(state.site?.pages.map((page) => page.url)).toEqual(['https://www.acme.com/', 'https://www.acme.com/pricing'])
  })

  // protects=unreachable, empty (JS-only) and invalid sites fail with codes the UI can explain;
  // fails_when=an empty page produces a profile from nothing, or a bad domain is fetched at all;
  // no_claim=does not distinguish DNS failure from HTTP errors in the message.
  it('fails clearly for unreachable, empty or invalid sites', async () => {
    await expect(crawl({})).rejects.toMatchObject({ code: 'site_unreachable' })
    await expect(crawl({ 'https://acme.com/': html('Acme', '<div id="root"></div>') })).rejects.toMatchObject({ code: 'site_unreadable' })
    const bad = crawl({}, 'localhost')
    await expect(bad).rejects.toBeInstanceOf(PipelineError)
    await expect(bad).rejects.toMatchObject({ code: 'invalid_url' })
  })
})
