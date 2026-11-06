// Regression: ISSUE-006 — the correction editor had no way to cancel
// Found by /qa on 2026-11-05
// Report: .gstack/qa-reports/qa-report-127-0-0-1-2026-11-05.md
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

describe('correction editor', () => {
  // protects=Cancel closes the editor without saving and keeps the original text;
  // fails_when=a visitor who opens the editor by mistake has to save to get out, or Cancel saves the draft;
  // no_claim=n/a.
  it('cancels without saving', () => {
    const onCorrect = vi.fn()
    render(<ProfileCard profile={PROFILE} corrections={{}} onCorrect={onCorrect} />)
    fireEvent.click(screen.getByRole('button', { name: 'Correct "Invoicing for agencies"' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Something else' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCorrect).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByText('Invoicing for agencies')).toBeTruthy()
  })
})
