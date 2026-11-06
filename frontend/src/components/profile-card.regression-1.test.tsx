// Regression: ISSUE-003 — the 'Correct this' buttons had identical accessible names
// Found by /qa on 2026-11-05
// Report: .gstack/qa-reports/qa-report-127-0-0-1-2026-11-05.md
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProductProfile } from '@/types'
import { ProfileCard } from './profile-card'

afterEach(cleanup)

const PROFILE: ProductProfile = {
  domain: 'acme.com', name: 'Acme Invoicing', oneLiner: 'Invoicing for agencies', valueProps: ['Fast GST invoices', 'Bank sync'], category: '',
  pricingSignals: [], servedMarkets: ['IN'], crawledAt: '2026-11-02T10:00:00.000Z',
  claims: [
    { field: 'oneLiner', text: 'Invoicing for agencies', sourceUrl: 'https://acme.com/' },
    { field: 'valueProp', text: 'Fast GST invoices', sourceUrl: 'https://acme.com/features' },
    { field: 'valueProp', text: 'Bank sync', sourceUrl: 'https://acme.com/features' },
  ],
}

describe('correct buttons', () => {
  // protects=each "Correct this" button names the claim it edits, so screen reader users can tell them apart;
  // fails_when=two or more buttons share the same accessible name;
  // no_claim=jsdom accessible names, not a real screen reader.
  it('names the claim each button corrects', () => {
    render(<ProfileCard profile={PROFILE} corrections={{}} onCorrect={() => {}} />)
    const names = screen.getAllByRole('button', { name: /correct/i }).map((button) => button.getAttribute('aria-label') ?? button.textContent)
    expect(names).toHaveLength(3)
    expect(new Set(names).size).toBe(3)
    expect(screen.getByRole('button', { name: 'Correct "Bank sync"' })).toBeTruthy()
  })
})
