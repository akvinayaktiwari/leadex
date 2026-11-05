// Regression: ISSUE-002 — progress and connection status were not announced to screen readers
// Found by /qa on 2026-11-05
// Report: .gstack/qa-reports/qa-report-127-0-0-1-2026-11-05.md
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { EMPTY_RUN } from '@/hooks/run-state'
import { StepTimeline } from './step-timeline'

afterEach(cleanup)

describe('step timeline announcements', () => {
  // protects=new steps and the reconnecting notice sit in a polite live region, so screen readers announce progress;
  // fails_when=the progress panel has no status/live region and blind users hear nothing while the run works;
  // no_claim=jsdom checks the markup, not a real screen reader.
  it('announces progress politely', () => {
    const run = { ...EMPTY_RUN, steps: [{ step: 'crawl' as const, label: 'Reading the website', state: 'started' as const }] }
    render(<StepTimeline run={run} connection="reconnecting" />)
    const status = screen.getByRole('status')
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(status.textContent).toContain('Reading the website')
    expect(status.textContent).toContain('reconnecting')
  })
})
