import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTurnstileRepository } from '../src/repositories/turnstile-repository.js'

describe('Turnstile siteverify (local HTTP server)', () => {
  let server: Server
  let url = ''
  const received: URLSearchParams[] = []

  beforeAll(async () => {
    server = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk: Buffer) => { body += chunk.toString() })
      request.on('end', () => {
        const form = new URLSearchParams(body)
        received.push(form)
        if (form.get('response') === 'down') return void response.writeHead(500).end()
        response.writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify(form.get('response') === 'good' ? { success: true } : { success: false, 'error-codes': ['invalid-input-response'] }))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/siteverify`
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  // protects=the token is posted as a form with the secret and the caller's IP, and only success: true passes; an outage throws
  // rather than letting requests through;
  // fails_when=an invalid token passes, the secret is not sent, or a Cloudflare 500 is treated as a pass;
  // no_claim=does not call Cloudflare; their test keys can be used for a manual check.
  it('passes only tokens Cloudflare confirms', async () => {
    const turnstile = createTurnstileRepository(url, 'secret-1')
    expect(await turnstile.verify('good', '203.0.113.7')).toBe(true)
    expect(received[0]?.get('secret')).toBe('secret-1')
    expect(received[0]?.get('remoteip')).toBe('203.0.113.7')
    expect(await turnstile.verify('bad', 'unknown')).toBe(false)
    expect(received[1]?.has('remoteip')).toBe(false)
    await expect(turnstile.verify('down', '203.0.113.7')).rejects.toThrow(/HTTP 500/)
  })
})
