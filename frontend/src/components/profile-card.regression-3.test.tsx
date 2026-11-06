// Regression: ISSUE-007 — ambiguous read date (11/2/2026)
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

describe('read date', () => {
  // protects=the date a page was read is written with the month as a word, so 2 Nov is never read as 11 Feb;
  // fails_when=the date uses a numeric day/month order that depends on the browser locale;
  // no_claim=timezone of the viewer still decides the day near midnight UTC.
  it('writes the month as a word', () => {
    render(<ProfileCard profile={PROFILE} corrections={{}} onCorrect={() => {}} />)
    expect(screen.getAllByText(/read 2 Nov 2026/)).toHaveLength(3)
  })
})
