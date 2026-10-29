import { describe, expect, it } from 'vitest'
import { isSameSite, normalizeDomain } from '../src/lib/domain.js'

describe('normalizeDomain', () => {
  // protects=the many ways people paste a site all map to one cache key (bare lower-case host);
  // fails_when=case, www, scheme, path, query, port or a trailing dot produce a different domain;
  // no_claim=does not resolve public-suffix rules (shop.example.co.uk stays as typed).
  it('normalizes common inputs to a bare host', () => {
    for (const input of ['qdnco.com', 'QDNCO.com', 'https://www.qdnco.com/pricing?x=1#top', 'http://qdnco.com:8080/', '  www.qdnco.com.  ', 'qdnco.com/about']) {
      expect(normalizeDomain(input)).toEqual({ ok: true, domain: 'qdnco.com' })
    }
    expect(normalizeDomain('app.acme.io')).toEqual({ ok: true, domain: 'app.acme.io' })
  })

  // protects=inputs that can't be a public website are rejected before any fetch (first SSRF line);
  // fails_when=localhost, IP literals, internal TLDs, credentials or non-http schemes get through;
  // no_claim=DNS that resolves a public-looking name to a private IP is caught by the fetch guard, not here.
  it('rejects non-public or malformed inputs', () => {
    const rejected = ['localhost', 'http://localhost:3000', '127.0.0.1', 'http://169.254.169.254/latest', '[::1]', 'intranet', 'printer.local', 'db.internal', 'ftp://acme.com', 'https://user:pw@acme.com', 'not a url', '']
    for (const input of rejected) expect(normalizeDomain(input).ok, input).toBe(false)
  })

  // protects=www and bare hosts count as one site when filtering crawl links;
  // fails_when=links to www.acme.com are dropped when the homepage is acme.com, or other domains are kept;
  // no_claim=does not treat other subdomains (blog.acme.com) as the same site.
  it('treats www and bare hosts as the same site', () => {
    expect(isSameSite('www.acme.com', 'acme.com')).toBe(true)
    expect(isSameSite('ACME.com', 'acme.com')).toBe(true)
    expect(isSameSite('blog.acme.com', 'acme.com')).toBe(false)
    expect(isSameSite('acme.com.evil.io', 'acme.com')).toBe(false)
  })
})
