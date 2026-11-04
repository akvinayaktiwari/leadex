import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebsiteForm } from './website-form'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  push.mockReset()
})

function submit(url: string): void {
  fireEvent.change(screen.getByLabelText('Your website'), { target: { value: url } })
  fireEvent.click(screen.getByRole('button', { name: 'Find my buyers' }))
}

describe('website form', () => {
  // protects=the form sends the Turnstile token the widget put in the form and the device id, then opens the analysis;
  // fails_when=the token or device id never reaches the API (every request would get 400 or skip the device limit);
  // no_claim=the real Cloudflare widget is not loaded in jsdom; its hidden field is added by hand.
  it('sends the Turnstile token and device id', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example')
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ runId: 'run_1', domain: 'acme.com', cached: false }), { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<WebsiteForm />)
    const field = Object.assign(document.createElement('input'), { type: 'hidden', name: 'cf-turnstile-response', value: 'token-1' })
    container.querySelector('form')?.append(field)
    submit('acme.com')
    await waitFor(() => expect(push).toHaveBeenCalledWith('/analysis?run=run_1&domain=acme.com'))
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as Record<string, string>
    expect(body).toMatchObject({ url: 'acme.com', turnstileToken: 'token-1' })
    expect(body.deviceId).toMatch(/^[0-9a-f-]{36}$/)
  })

  // protects=with Turnstile configured, a submit before the check finishes asks the visitor to wait instead of sending a request
  // that would be refused;
  // fails_when=the form posts without a token and shows a confusing 400;
  // no_claim=n/a.
  it('waits for the human check', () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example')
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '1x00000000000000000000AA')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<WebsiteForm />)
    submit('acme.com')
    expect(screen.getByRole('alert').textContent).toMatch(/human check/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
