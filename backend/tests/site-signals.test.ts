import { describe, expect, it } from 'vitest'
import { detectTechnologies, findJobBoards, readPageSignals } from '../src/lib/site-signals.js'

const page = (head: string, body: string): string => `<html><head>${head}</head><body>${body}</body></html>`

describe('site signals', () => {
  // protects=ad pixels and common platforms are detected from script sources and inline snippets;
  // fails_when=a Google Ads conversion tag or Meta pixel is missed, or plain text mentioning "shopify" counts as Shopify;
  // no_claim=pattern matching only; a tag loaded later by a tag manager is invisible.
  it('detects technologies and ad pixels', () => {
    const html = page(
      `<script async src="https://www.googletagmanager.com/gtag/js?id=AW-123456789"></script>
       <script>!function(f){}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','1')</script>
       <script src="https://js.hs-scripts.com/123.js"></script>`,
      '<img src="/wp-content/uploads/a.png"><p>We love Shopify stores</p>',
    )
    expect(detectTechnologies(html)).toEqual(['google_ads', 'meta_pixel', 'hubspot', 'wordpress'])
  })

  // protects=the business's own JSON-LD gives name, legal name, phone and a normalized country, including @graph and nested address;
  // fails_when=a WebSite or BlogPosting node is taken as the organization, broken JSON throws, or "in" is not normalized to IN;
  // no_claim=does not verify the markup is truthful.
  it('reads the organization from JSON-LD', () => {
    const jsonLd = JSON.stringify({ '@context': 'https://schema.org', '@graph': [
      { '@type': 'WebSite', name: 'Not this' },
      { '@type': ['Organization', 'Thing'], name: 'Acme', legalName: 'Acme Pvt Ltd', telephone: '+91 80 1234',
        address: { '@type': 'PostalAddress', addressCountry: 'in', addressLocality: 'Bengaluru', addressRegion: 'KA' } },
    ] })
    const html = page(`<script type="application/ld+json">{ broken</script><script type="application/ld+json">${jsonLd}</script>`, '')
    const signals = readPageSignals(html, 'https://acme.com/', [])
    expect(signals.hasStructuredData).toBe(true)
    expect(signals.organization).toEqual({ name: 'Acme', legalName: 'Acme Pvt Ltd', telephone: '+91 80 1234', country: 'IN', region: 'KA', city: 'Bengaluru', foundingDate: undefined })
  })

  // protects=an agency credit is recorded only from footer wording ("Website by" 0.9, bare "by" 0.75), never for
  // platforms, the site's own links or unlabelled links;
  // fails_when="Powered by Shopify" becomes an agency, a footer "Privacy" link becomes an agency, or the credit is missed;
  // no_claim=English wording only.
  it('finds agency credits by wording', () => {
    const credited = page('', '<footer><p>© Acme. Website by <a href="https://pixelworks.studio">Pixelworks</a></p></footer>')
    expect(readPageSignals(credited, 'https://acme.com/', []).agency).toEqual({ name: 'Pixelworks', url: 'https://pixelworks.studio', confidence: 0.9 })
    const bare = page('', '<div class="site-footer"><span>by <a href="https://studio9.in">Studio9</a></span></div>')
    expect(readPageSignals(bare, 'https://acme.com/', []).agency?.confidence).toBe(0.75)
    const notAgency = page('', '<footer>Powered by <a href="https://shopify.com">Shopify</a> <a href="https://acme.com/privacy">Privacy</a> <a href="https://x.com/acme">X</a></footer>')
    expect(readPageSignals(notAgency, 'https://acme.com/', []).agency).toBeUndefined()
  })

  // protects=public job boards linked from the site are found once each, with provider and board id;
  // fails_when=a duplicate link is counted twice, an EU Greenhouse board is missed, or an unrelated host matches;
  // no_claim=does not fetch the boards (open roles are read in a later step).
  it('finds linked job boards', () => {
    expect(findJobBoards([
      'https://boards.greenhouse.io/acme', 'https://boards.greenhouse.io/acme/jobs/1', 'https://job-boards.eu.greenhouse.io/acmeeu',
      'https://jobs.lever.co/acme', 'https://jobs.ashbyhq.com/Acme', 'https://apply.workable.com/acme-1/', 'https://acme.com/careers',
    ]).map((board) => `${board.provider}:${board.board}`)).toEqual(['greenhouse:acme', 'greenhouse:acmeeu', 'lever:acme', 'ashby:acme', 'workable:acme-1'])
  })
})
