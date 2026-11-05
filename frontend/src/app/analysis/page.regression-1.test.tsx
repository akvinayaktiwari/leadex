// Regression: ISSUE-004 — analysis pages had no way back to start a new analysis
// Found by /qa on 2026-11-05
// Report: .gstack/qa-reports/qa-report-127-0-0-1-2026-11-05.md
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AnalysisPage from './page'

const params = { value: new URLSearchParams() }
vi.mock('next/navigation', () => ({ useSearchParams: () => params.value }))

afterEach(cleanup)

describe('analysis page navigation', () => {
  // protects=a link without its analysis offers a link home, and a loaded analysis links back to Leadex's home page;
  // fails_when=visitors are told to "start again from the home page" with no link, or are stuck on an analysis;
  // no_claim=the stream is not started here (no EventSource in jsdom is needed for the missing-query case).
  it('links home from a link without its analysis', () => {
    params.value = new URLSearchParams()
    render(<AnalysisPage />)
    expect(screen.getByRole('link', { name: /start a new analysis/i }).getAttribute('href')).toBe('/')
  })

  it('links home from an analysis', () => {
    params.value = new URLSearchParams({ run: 'run_1', domain: 'acme.com' })
    vi.stubGlobal('EventSource', class { addEventListener(): void {} close(): void {} readyState = 0; onerror = null; onopen = null })
    render(<AnalysisPage />)
    expect(screen.getByRole('link', { name: 'Leadex' }).getAttribute('href')).toBe('/')
    vi.unstubAllGlobals()
  })
})
