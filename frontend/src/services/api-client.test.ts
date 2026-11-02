import { afterEach, describe, expect, it, vi } from 'vitest'
import { startAnalysis } from './api-client'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('startAnalysis', () => {
  // protects=a started analysis returns its run id and domain; API errors and network failures become a message the form shows;
  // fails_when=a 400 or 503 is treated as success, or a network error throws into the page;
  // no_claim=mocked fetch.
  it('returns the run or a message', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ runId: 'run_1', domain: 'acme.com' }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'invalid_url', message: 'Enter a website like yourcompany.com' } }), { status: 400 }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)
    expect(await startAnalysis('acme.com')).toEqual({ ok: true, runId: 'run_1', domain: 'acme.com' })
    expect(await startAnalysis('nope')).toEqual({ ok: false, message: 'Enter a website like yourcompany.com' })
    expect(await startAnalysis('acme.com')).toEqual({ ok: false, message: 'Could not reach Leadex: Failed to fetch' })
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.example/api/analyses')
  })
})
