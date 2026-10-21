import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isPublicAddress } from '../src/lib/address-policy.js'
import { createSiteFetchRepository } from '../src/repositories/site-fetch-repository.js'

let server: Server
let base: string
const seenUserAgents: string[] = []

beforeAll(async () => {
  server = createServer((req, res) => {
    seenUserAgents.push(req.headers['user-agent'] ?? '')
    const routes: Record<string, () => void> = {
      '/': () => res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<html><body>home</body></html>'),
      '/hop': () => res.writeHead(301, { location: '/' }).end(),
      '/loop': () => res.writeHead(302, { location: '/loop' }).end(),
      '/to-metadata': () => res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }).end(),
      '/big': () => res.writeHead(200, { 'content-type': 'text/html' }).end('x'.repeat(5_000)),
      '/image': () => res.writeHead(200, { 'content-type': 'image/png' }).end('png'),
      '/robots.txt': () => res.writeHead(200, { 'content-type': 'text/plain' }).end('User-agent: *\nDisallow:'),
      '/slow': () => setTimeout(() => res.writeHead(200, { 'content-type': 'text/html' }).end('late'), 1_000),
    }
    const handler = routes[req.url ?? ''] ?? (() => res.writeHead(404).end())
    handler()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

// The test server is on loopback, so the policy lets exactly 127.0.0.1 through and blocks everything private.
const loopbackOnly = (address: string): boolean => address === '127.0.0.1' || isPublicAddress(address)
const repository = () => createSiteFetchRepository({ userAgent: 'LeadexBot/1.0 (+test)', maxBytes: 1_000, maxRedirects: 3, isAllowedAddress: loopbackOnly })

describe('site fetch repository', () => {
  // protects=an HTML page is returned with its final URL after following redirects, using our user agent;
  // fails_when=redirects aren't followed, finalUrl is the pre-redirect URL, or the bot UA is missing;
  // no_claim=does not test HTTPS or real DNS.
  it('fetches HTML and follows redirects', async () => {
    const result = await repository().fetchText({ url: `${base}/hop`, accept: 'html', timeoutMs: 2_000 })
    expect(result).toMatchObject({ ok: true, finalUrl: `${base}/`, status: 200 })
    expect(result.ok && result.body).toContain('home')
    expect(seenUserAgents.at(-1)).toBe('LeadexBot/1.0 (+test)')
  })

  // protects=SSRF: the default policy refuses loopback, and a redirect to the metadata IP is refused without connecting;
  // fails_when=a user-supplied URL or a redirect reaches 127.0.0.1 or 169.254.169.254;
  // no_claim=does not test DNS rebinding with a real resolver (the guard runs in the connect-time lookup).
  it('blocks non-public hosts, including via redirect', async () => {
    const strict = createSiteFetchRepository({ userAgent: 'x', maxBytes: 1_000, maxRedirects: 3, isAllowedAddress: isPublicAddress })
    expect(await strict.fetchText({ url: `${base}/`, accept: 'html', timeoutMs: 2_000 })).toEqual({ ok: false, reason: 'blocked_host' })
    expect(await strict.fetchText({ url: `http://localhost:${new URL(base).port}/`, accept: 'html', timeoutMs: 2_000 })).toEqual({ ok: false, reason: 'blocked_host' })
    expect(await repository().fetchText({ url: `${base}/to-metadata`, accept: 'html', timeoutMs: 2_000 })).toEqual({ ok: false, reason: 'blocked_host' })
  })

  // protects=bad responses become typed failures instead of exceptions or giant strings;
  // fails_when=an oversized body is buffered, an image is treated as HTML, a 404 counts as success, or a redirect loop spins;
  // no_claim=does not test non-UTF-8 charsets.
  it('reports size, type, status and redirect-loop failures', async () => {
    const repo = repository()
    expect(await repo.fetchText({ url: `${base}/big`, accept: 'html', timeoutMs: 2_000 })).toMatchObject({ ok: false, reason: 'too_large' })
    expect(await repo.fetchText({ url: `${base}/image`, accept: 'html', timeoutMs: 2_000 })).toMatchObject({ ok: false, reason: 'unsupported_type' })
    expect(await repo.fetchText({ url: `${base}/missing`, accept: 'html', timeoutMs: 2_000 })).toMatchObject({ ok: false, reason: 'http_error', status: 404 })
    expect(await repo.fetchText({ url: `${base}/loop`, accept: 'html', timeoutMs: 2_000 })).toMatchObject({ ok: false, reason: 'http_error' })
    expect(await repo.fetchText({ url: `${base}/robots.txt`, accept: 'text', timeoutMs: 2_000 })).toMatchObject({ ok: true })
  })

  // protects=a slow server can't hold a crawl past its timeout;
  // fails_when=the request waits for the full response after the timeout;
  // no_claim=uses a 200 ms timeout, not production values.
  it('times out slow responses', async () => {
    const started = Date.now()
    expect(await repository().fetchText({ url: `${base}/slow`, accept: 'html', timeoutMs: 200 })).toEqual({ ok: false, reason: 'timeout' })
    expect(Date.now() - started).toBeLessThan(900)
  })
})
