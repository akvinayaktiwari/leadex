// Regression: ISSUE-005 — a developer API status line showed on the home page
// Found by /qa on 2026-11-05
// Report: .gstack/qa-reports/qa-report-127-0-0-1-2026-11-05.md
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import HomePage from './page'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

describe('home page', () => {
  // protects=visitors never see the API health check line; it shows only in local development;
  // fails_when=a production page prints "API unreachable…" or "API connected…" under the form;
  // no_claim=n/a.
  it('hides the API status outside development', () => {
    vi.stubEnv('NODE_ENV', 'production')
    render(<HomePage />)
    expect(screen.queryByText(/API (unreachable|connected)|Checking API/)).toBeNull()
  })
})
