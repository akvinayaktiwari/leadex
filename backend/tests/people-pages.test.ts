import { describe, expect, it } from 'vitest'
import { PEOPLE_CRAWL } from '../src/services/people-pages.js'
import { crawlSite } from '../src/services/pipeline-steps/crawl-step.js'
import { fakeSite, html } from './support/analysis-fakes.js'
import { manualClock } from './support/in-memory-run-store.js'

describe('people page crawl', () => {
  // protects=the people crawl follows only the site's own team/about/contact links, team pages first, at most 6 pages, at most
  // 2 per section, and never product or blog pages;
  // fails_when=a /pricing or /blog page is fetched, the 7th people page is fetched, or /team comes after /contact;
  // no_claim=path patterns only; a team page at an unusual path (e.g. /us) is missed.
  it('reads only people pages, team first', async () => {
    const links = ['/pricing', '/blog/post-1', '/contact', '/about', '/our-team', '/leadership', '/team/asha', '/team/ravi', '/team/priya', '/meet-the-dentists', '/history']
      .map((path) => `https://acme.com${path}`)
    const pages: Record<string, string> = { 'https://acme.com/': html('Acme', 'Welcome to Acme dental clinic in Pune', links) }
    for (const link of links) pages[link] = html(link, `Page ${link} with enough text to read.`)
    const site = fakeSite(pages)
    const crawled = await crawlSite({ siteFetch: site, clock: manualClock() }, 'acme.com', PEOPLE_CRAWL)
    expect(crawled.pages.map((page) => page.path)).toEqual(['/', '/our-team', '/leadership', '/team/asha', '/team/ravi', '/meet-the-dentists', '/about'])
    expect(site.requested.some((url) => /pricing|blog/.test(url))).toBe(false)
  })
})
