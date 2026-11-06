// Regression: ISSUE-007 — 'Build leads for 0 segments' when nothing is picked
// Found by /qa on 2026-11-05
// Report: .gstack/qa-reports/qa-report-127-0-0-1-2026-11-05.md
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SegmentPicker } from './segment-picker'

afterEach(cleanup)

const SEGMENT = {
  segmentId: 'a', name: 'Design agencies', useCase: 'Bill clients', pain: 'Late payments', criteria: ['Bills monthly'], buyerTitles: ['Founder'], sharePct: 60,
  filters: { industries: [], employeeMin: 0, employeeMax: 0, countries: ['IN'], keywords: [], technologies: [] },
}

describe('build button label', () => {
  // protects=with nothing picked the button asks the visitor to pick segments instead of offering to build for 0;
  // fails_when=the label reads "Build leads for 0 segments";
  // no_claim=n/a.
  it('asks for a pick when none is selected', () => {
    render(<SegmentPicker segments={[SEGMENT]} selected={new Set()} onToggle={() => {}} />)
    expect(screen.getByRole('button', { name: 'Pick segments to build leads' })).toBeTruthy()
  })
})
