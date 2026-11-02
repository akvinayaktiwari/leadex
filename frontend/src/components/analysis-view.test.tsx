import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { EventSourceLike } from '@/hooks/use-run-events'
import type { RunEvent } from '@/types'
import { AnalysisView } from './analysis-view'

afterEach(cleanup)

const TS = '2026-11-02T10:00:00.000Z'
const PROFILE = {
  domain: 'acme.com', name: 'Acme Invoicing', oneLiner: 'Invoicing for agencies', valueProps: ['Fast GST invoices'], category: 'invoicing software',
  pricingSignals: [], servedMarkets: ['IN'], crawledAt: TS,
  claims: [
    { field: 'oneLiner', text: 'Invoicing for agencies', sourceUrl: 'https://acme.com/' },
    { field: 'category', text: 'invoicing software', sourceUrl: 'https://acme.com/about' },
    { field: 'valueProp', text: 'Fast GST invoices', sourceUrl: '' },
  ],
}
const segment = (id: string, name: string, sharePct: number) => ({
  segmentId: id, name, useCase: 'Bill clients', pain: 'Late payments', criteria: ['Bills monthly'], buyerTitles: ['Founder', 'Finance Manager'], sharePct,
  filters: { industries: [], employeeMin: 0, employeeMax: 0, countries: ['IN'], keywords: [], technologies: [] },
})
const EVENTS: RunEvent[] = [
  { seq: 1, ts: TS, kind: 'step', step: 'crawl', state: 'started', label: 'Reading the website' },
  { seq: 2, ts: TS, kind: 'step', step: 'crawl', state: 'completed', label: 'Reading the website', durationMs: 1200 },
  { seq: 3, ts: TS, kind: 'artifact', step: 'profile', artifact: 'profile', data: PROFILE },
  { seq: 4, ts: TS, kind: 'artifact', step: 'competitors', artifact: 'competitor', data: { domain: 'billbook.in', name: 'Billbook', reason: 'GST invoicing', country: 'IN', countrySource: 'cctld' } },
  { seq: 5, ts: TS, kind: 'artifact', step: 'segments', artifact: 'segment', data: segment('a', 'Design agencies', 60) },
  { seq: 6, ts: TS, kind: 'artifact', step: 'segments', artifact: 'segment', data: segment('b', 'IT consultancies', 40) },
]

class ScriptedSource implements EventSourceLike {
  readyState = 1
  onerror: ((event: Event) => void) | null = null
  onopen: ((event: Event) => void) | null = null
  private listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>()
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]) }
  close(): void { this.readyState = 2 }
  emit(events: RunEvent[]): void { for (const event of events) for (const l of this.listeners.get(event.kind) ?? []) l(new MessageEvent(event.kind, { data: JSON.stringify(event) })) }
}

function renderWith(events: RunEvent[]) {
  const source = new ScriptedSource()
  render(<AnalysisView runId="run_1" domain="acme.com" createSource={() => source} />)
  act(() => source.emit(events))
  return source
}

describe('analysis view', () => {
  // protects=#6: each product claim shows its source page and read date, and a claim without a source is flagged for checking;
  // fails_when=a claim is shown without provenance, or an unsourced claim looks as trustworthy as a sourced one;
  // no_claim=jsdom rendering; visual layout is not checked.
  it('shows each claim with its source and date', () => {
    renderWith(EVENTS)
    expect(screen.getByText('Acme Invoicing')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'acme.com' }).getAttribute('href')).toBe('https://acme.com/')
    expect(screen.getByRole('link', { name: '/about' })).toBeTruthy()
    expect(screen.getAllByText(/read /)).toHaveLength(2)
    expect(screen.getByText('No source, check this')).toBeTruthy()
  })

  // protects=#6: "Correct this" edits a claim inline before any lead build, and the correction is shown as the user's;
  // fails_when=the edit is lost, or the original text keeps showing;
  // no_claim=sending corrections to a lead build is #12.
  it('lets the user correct a claim', () => {
    renderWith(EVENTS)
    fireEvent.click(screen.getAllByRole('button', { name: 'Correct this' })[0]!)
    fireEvent.change(screen.getByLabelText('What you sell'), { target: { value: 'Invoicing for design studios' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText('Invoicing for design studios')).toBeTruthy()
    expect(screen.getByText('(corrected by you)')).toBeTruthy()
  })

  // protects=#6 done-when: a stream that replays events after a reconnect shows each card once;
  // fails_when=a second competitor or segment card appears after the replay;
  // no_claim=n/a.
  it('renders each card once even when events are replayed', () => {
    const source = renderWith(EVENTS)
    act(() => source.emit(EVENTS.slice(2)))
    expect(screen.getAllByText('Billbook')).toHaveLength(1)
    expect(screen.getAllByText('Design agencies')).toHaveLength(1)
    expect(screen.getAllByRole('listitem').filter((li) => li.textContent?.includes('Reading the website'))).toHaveLength(1)
  })

  // protects=segments can be picked, with the count reflected on the (not yet enabled) build button;
  // fails_when=selection does not register or the build button is clickable before lead builds exist;
  // no_claim=n/a.
  it('lets the user pick segments', () => {
    renderWith(EVENTS)
    fireEvent.click(screen.getByLabelText(/Design agencies/))
    const button = screen.getByRole('button', { name: 'Build leads for 1 segment' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })
})
