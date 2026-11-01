import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { VerifierOutOfCredits, VerifierRateLimited } from '../src/lib/errors.js'
import { createBouncerVerifier } from '../src/repositories/bouncer-verifier-repository.js'
import { createMailDnsRepository } from '../src/repositories/mail-dns-repository.js'

// Responses shaped like Bouncer's documented real-time API (docs.usebouncer.com, read 2026-11-01).
const ANSWERS: Record<string, object> = {
  'good@acme.com': { email: 'good@acme.com', status: 'deliverable', reason: 'accepted_email', domain: { acceptAll: 'no', disposable: 'no' }, account: { role: 'no', disabled: 'no', fullMailbox: 'no' }, score: 100, toxicity: 0 },
  'any@catchall.com': { email: 'any@catchall.com', status: 'risky', reason: 'low_deliverability', domain: { acceptAll: 'yes' }, score: 60 },
  'deliverable-but-acceptall@catchall.com': { email: 'x', status: 'deliverable', reason: 'accepted_email', domain: { acceptAll: 'yes' } },
  'gone@acme.com': { email: 'gone@acme.com', status: 'undeliverable', reason: 'rejected_email' },
  'trap@acme.com': { email: 'trap@acme.com', status: 'deliverable', reason: 'accepted_email', domain: { acceptAll: 'no' }, toxicity: 4 },
  'full@acme.com': { email: 'full@acme.com', status: 'deliverable', reason: 'accepted_email', account: { fullMailbox: 'yes' } },
  'slow@acme.com': { email: 'slow@acme.com', status: 'unknown', reason: 'timeout', retryAfter: '2026-11-01T13:00:00Z' },
  'temp@mailinator.com': { email: 'temp@mailinator.com', status: 'deliverable', reason: 'accepted_email', domain: { disposable: 'yes' } },
}

describe('Bouncer verifier (local fake API)', () => {
  let server: Server
  let base = ''
  const seenKeys: string[] = []

  beforeAll(async () => {
    server = createServer((request, response) => {
      const url = new URL(request.url ?? '', 'http://x')
      seenKeys.push(String(request.headers['x-api-key']))
      const email = url.searchParams.get('email') ?? ''
      if (url.pathname !== '/v1.1/email/verify') return void response.writeHead(404).end()
      if (email === 'nocredits@acme.com') return void response.writeHead(402).end('{"message":"0 credits left."}')
      if (email === 'busy@acme.com') return void response.writeHead(429).end()
      if (email === 'weird@acme.com') return void response.writeHead(200).end('{"unexpected":true}')
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(ANSWERS[email]))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  // protects=only a deliverable address with no risk flags is 'valid'; accept-all, disposable, toxic, full or disabled
  // mailboxes are never valid; unknowns keep the retry time; the API key goes in x-api-key;
  // fails_when=a catch-all "deliverable" or a spam-trap-linked address is delivered (bounces and spam complaints hurt the
  // sender), or a disposable address counts as a lead;
  // no_claim=fake server built from Bouncer's docs; real responses are checked once an account exists.
  it('maps verifier answers conservatively', async () => {
    const verifier = createBouncerVerifier(base, 'test-key')
    const statuses: Record<string, string> = {}
    for (const email of Object.keys(ANSWERS)) statuses[email] = (await verifier.verify(email)).status
    expect(statuses).toEqual({
      'good@acme.com': 'valid', 'any@catchall.com': 'catch_all', 'deliverable-but-acceptall@catchall.com': 'catch_all', 'gone@acme.com': 'invalid',
      'trap@acme.com': 'invalid', 'full@acme.com': 'invalid', 'slow@acme.com': 'unknown', 'temp@mailinator.com': 'invalid',
    })
    expect((await verifier.verify('slow@acme.com')).retryAfter).toBe('2026-11-01T13:00:00Z')
    expect(new Set(seenKeys)).toEqual(new Set(['test-key']))
  })

  // protects=running out of credits and rate limits are distinct errors the batch can act on; an unexpected body fails loudly;
  // fails_when=a 402 is treated as "invalid address" (every remaining lead would be dropped) or a changed API silently maps to 'valid';
  // no_claim=n/a.
  it('reports credits, rate limits and unexpected bodies', async () => {
    const verifier = createBouncerVerifier(base, 'test-key')
    await expect(verifier.verify('nocredits@acme.com')).rejects.toBeInstanceOf(VerifierOutOfCredits)
    await expect(verifier.verify('busy@acme.com')).rejects.toBeInstanceOf(VerifierRateLimited)
    await expect(verifier.verify('weird@acme.com')).rejects.toThrow()
  })
})

describe('mail DNS repository', () => {
  const resolver = (answers: Record<string, { exchange: string; priority: number }[] | string>) => async (domain: string) => {
    const answer = answers[domain]
    if (typeof answer === 'string') throw Object.assign(new Error(answer), { code: answer })
    return answer ?? []
  }

  // protects=the preferred MX decides the provider (Google, Microsoft, other); no MX, a null MX or a missing domain means the
  // domain cannot receive mail; other DNS failures are errors, not "no mail";
  // fails_when=a backup MX is taken as primary, a DNS timeout silently drops a company, or "." is treated as a mail host;
  // no_claim=injected resolver; one real lookup is checked by hand.
  it('reads MX records', async () => {
    const repository = createMailDnsRepository(resolver({
      'acme.com': [{ exchange: 'alt1.aspmx.l.google.com', priority: 5 }, { exchange: 'ASPMX.L.GOOGLE.COM', priority: 1 }],
      'contoso.com': [{ exchange: 'contoso-com.mail.protection.outlook.com', priority: 10 }],
      'own.com': [{ exchange: 'mx.own.com', priority: 10 }],
      'nullmx.com': [{ exchange: '.', priority: 0 }],
      'gone.com': 'ENOTFOUND',
      'flaky.com': 'ETIMEOUT',
    }))
    expect(await repository.lookup('acme.com')).toEqual({ domain: 'acme.com', mxHost: 'aspmx.l.google.com', provider: 'google' })
    expect((await repository.lookup('contoso.com')).provider).toBe('microsoft')
    expect((await repository.lookup('own.com')).provider).toBe('other')
    expect((await repository.lookup('nullmx.com')).mxHost).toBe('')
    expect((await repository.lookup('gone.com')).mxHost).toBe('')
    await expect(repository.lookup('flaky.com')).rejects.toThrow(/ETIMEOUT/)
  })
})
