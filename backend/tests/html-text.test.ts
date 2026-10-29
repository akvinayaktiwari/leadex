import { describe, expect, it } from 'vitest'
import { extractPage } from '../src/lib/html-text.js'

const HTML = `<!doctype html><html><head><title> Acme  Invoicing </title>
<meta name="description" content="Invoices for small teams."><style>.x{color:red}</style></head>
<body><header><nav><a href="/pricing">Pricing</a><a href="about#team">About</a><a href="mailto:hi@acme.com">Mail</a></nav></header>
<main><h1>Get paid</h1><p>Send invoices<br>in seconds.</p><script>alert(1)</script>
<a href="https://other.com/x">Partner</a><a href="/pricing">Pricing again</a></main></body></html>`

describe('extractPage', () => {
  // protects=visible text is extracted with word boundaries kept, and scripts/styles dropped;
  // fails_when=blocks fuse ("PricingAbout"), script or CSS text leaks into what the LLM reads;
  // no_claim=does not render JavaScript-only sites.
  it('extracts readable text, title and description', () => {
    const page = extractPage(HTML, 'https://acme.com/')
    expect(page.title).toBe('Acme Invoicing')
    expect(page.description).toBe('Invoices for small teams.')
    expect(page.text).toContain('Pricing About')
    expect(page.text).toContain('Send invoices in seconds.')
    expect(page.text).not.toContain('alert(1)')
    expect(page.text).not.toContain('color:red')
  })

  // protects=links are absolute http(s), de-duplicated, without fragments, nav first;
  // fails_when=relative links stay relative, mailto: links appear, or the same page is listed twice;
  // no_claim=does not filter by site (the crawl step does).
  it('returns absolute, de-duplicated links with navigation first', () => {
    const page = extractPage(HTML, 'https://acme.com/')
    expect(page.links).toEqual(['https://acme.com/pricing', 'https://acme.com/about', 'https://other.com/x'])
  })
})
