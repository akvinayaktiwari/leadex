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

  // protects=an agency is recorded only from explicit design/build wording in the footer, never from platform,
  // ownership or "powered by" lines, the site's own links, or unlabelled links;
  // fails_when="Powered by Shopify", "operated by Informa TechTarget" or "Powered by iNaturalist open source software"
  // (both seen on real sites, 2026-11-01) becomes an agency, or a real "Website by" credit is missed;
  // no_claim=English wording only.
  it('finds agency credits only from explicit wording', () => {
    const credited = page('', '<footer><p>© Acme. Website by <a href="https://pixelworks.studio">Pixelworks</a></p></footer>')
    expect(readPageSignals(credited, 'https://acme.com/', []).agency).toEqual({ name: 'Pixelworks', url: 'https://pixelworks.studio', confidence: 0.9 })
    const designed = page('', '<div class="site-footer"><span>Design & development by <a href="https://studio9.in">Studio9</a></span></div>')
    expect(readPageSignals(designed, 'https://acme.com/', []).agency?.name).toBe('Studio9')
    for (const footer of [
      'Powered by <a href="https://shopify.com">Shopify</a> <a href="https://acme.com/privacy">Privacy</a> <a href="https://x.com/acme">X</a>',
      'TechTarget is operated by <a href="https://informatechtarget.com">Informa TechTarget</a>',
      'Powered by <a href="https://github.com/inaturalist">iNaturalist open source software</a>',
      'Acme is a part of <a href="https://bigco.com">BigCo Group</a>. Made with care by our team.',
    ]) expect(readPageSignals(page('', `<footer>${footer}</footer>`), 'https://acme.com/', []).agency, footer).toBeUndefined()
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

  // protects=people come only from the organization's own founder/employee entries, and page emails are collected;
  // fails_when=a blog post's author or a review's author becomes staff, or a founder listed by name only is dropped;
  // no_claim=does not verify the markup is current.
  it('reads founders and employees from the organization markup', () => {
    const jsonLd = JSON.stringify([
      { '@type': 'Organization', name: 'Acme', founder: [{ '@type': 'Person', name: 'Asha Rao' }, 'Ravi Kumar'],
        employee: { '@type': 'Person', name: 'Priya Shah', jobTitle: 'Head of Marketing' } },
      { '@type': 'BlogPosting', author: { '@type': 'Person', name: 'Guest Writer' } },
    ])
    const html = page(`<script type="application/ld+json">${jsonLd}</script>`, '<a href="mailto:asha@acme.com">Email Asha</a>')
    const signals = readPageSignals(html, 'https://www.acme.com/about', [])
    expect(signals.people).toEqual([
      { name: 'Asha Rao', title: 'Founder' }, { name: 'Ravi Kumar', title: 'Founder' }, { name: 'Priya Shah', title: 'Head of Marketing' },
    ])
    expect(signals.emails).toEqual([{ email: 'asha@acme.com', kind: 'personal' }])
  })
})
