import { describe, expect, it } from 'vitest'
import type { SegmentsDraft } from '../src/lib/schemas.js'
import { createSegmentsStep } from '../src/services/pipeline-steps/segments-step.js'
import { buildSegments, normalizeShares, segmentCountries } from '../src/services/segment-rules.js'
import type { AnalysisState, IcpSegment, ProductProfile, StepContext, StepEmission } from '../src/types/index.js'
import { fakeLlm, okJson } from './support/analysis-fakes.js'
import { sampleRun } from './support/in-memory-run-store.js'

const PROFILE: ProductProfile = {
  domain: 'qdnco.com', name: 'QD & Co.', oneLiner: 'Real estate performance marketing', valueProps: ['a', 'b', 'c'],
  category: 'real estate marketing agency', pricingSignals: [], servedMarkets: ['IN', 'AE'], claims: [], crawledAt: '2026-11-02T10:00:00.000Z',
}

const segment = (name: string, sharePct: number, overrides: Partial<SegmentsDraft['segments'][number]> = {}): SegmentsDraft['segments'][number] => ({
  name, useCase: 'Generate site visits', pain: 'Leads that never visit', criteria: ['Has an active project', 'Runs ads'], buyerTitles: ['Marketing Head', 'Director'],
  industries: ['real_estate'], employeeMin: 10, employeeMax: 200, countries: ['IN'], keywords: ['Villas', 'villas', 'RERA'], technologies: [], sharePct, ...overrides,
})

// 20 share fixtures: uneven, tied, all-zero, already 100, tiny, huge, fractional.
const SHARE_FIXTURES: number[][] = [
  [40, 30, 20, 10], [25, 25, 25, 25], [33, 33, 33, 1], [0, 0, 0, 0], [1, 1, 1, 1, 1, 1], [100, 100, 100, 100], [50, 30, 15, 3, 2],
  [10.5, 20.25, 30.125, 38.875], [7, 7, 7], [99, 0.5, 0.5, 0], [60, 20, 10, 5, 3, 2], [1, 2, 3, 4, 5, 6], [12, 34, 56, 78], [33.3, 33.3, 33.4],
  [0, 50, 50, 0], [5, 5, 5, 5, 5], [80, 15, 5, 0], [3, 3, 3, 1], [45, 45, 5, 5, 0, 0], [1, 0, 0, 0],
]

describe('segment rules', () => {
  // protects=#5 done-when: shares always sum to exactly 100, as integers, in proportion to the model's weights;
  // fails_when=rounding leaves 99 or 101, a zero-weight list divides by zero, or a larger weight gets a smaller share;
  // no_claim=does not judge whether the model's weights are realistic.
  it('normalizes shares to exactly 100 for 20 fixtures', () => {
    expect(SHARE_FIXTURES).toHaveLength(20)
    for (const weights of SHARE_FIXTURES) {
      const shares = normalizeShares(weights)
      expect(shares.reduce((sum, share) => sum + share, 0), JSON.stringify(weights)).toBe(100)
      expect(shares.every(Number.isInteger)).toBe(true)
      for (let i = 0; i < weights.length; i++) for (let j = 0; j < weights.length; j++) {
        if ((weights[i] ?? 0) > (weights[j] ?? 0)) expect(shares[i] ?? 0, JSON.stringify(weights)).toBeGreaterThanOrEqual(shares[j] ?? 0)
      }
    }
    expect(normalizeShares([0, 0, 0, 0])).toEqual([25, 25, 25, 25])
  })

  // protects=segment countries stay inside the served markets and outside the EU/EEA/UK, falling back to the served markets;
  // fails_when=a segment for a Bangalore/Dubai agency targets Germany or the UK, or an empty list loses the served markets;
  // no_claim=n/a.
  it('limits segment countries to served, deliverable markets', () => {
    expect(segmentCountries(['IN', 'de', 'GB', 'US'], PROFILE)).toEqual(['IN'])
    expect(segmentCountries(['DE'], PROFILE)).toEqual(['IN', 'AE'])
    expect(segmentCountries(['US', 'FR'], { ...PROFILE, servedMarkets: ['GLOBAL'] })).toEqual(['US'])
    expect(segmentCountries([], { ...PROFILE, servedMarkets: ['GLOBAL'] })).toEqual([])
  })

  // protects=duplicates merge (shares added), size ranges are put in order, keywords are lowercased and deduplicated, and ids are
  // stable for the same business and name;
  // fails_when=two "Villa developers" segments appear, min > max reaches the search, or ids change between runs;
  // no_claim=n/a.
  it('cleans segments', () => {
    const draft: SegmentsDraft = { segments: [
      segment('Villa developers', 30), segment('villa developers', 10), segment('Plotted developers', 20, { employeeMin: 500, employeeMax: 50 }),
      segment('Brokerages', 20), segment('Commercial developers', 20),
    ] }
    const built = buildSegments(draft, PROFILE)
    expect(built.map((s) => `${s.name}:${s.sharePct}`)).toEqual(['Villa developers:40', 'Plotted developers:20', 'Brokerages:20', 'Commercial developers:20'])
    expect(built[1]?.filters).toMatchObject({ employeeMin: 50, employeeMax: 500 })
    expect(built[0]?.filters.keywords).toEqual(['villas', 'rera'])
    expect(buildSegments(draft, PROFILE)[0]?.segmentId).toBe(built[0]?.segmentId)
    expect(built[0]?.segmentId).toMatch(/^villa-developers-[0-9a-f]{6}$/)
  })
})

describe('segments step', () => {
  // protects=the step uses the smart model with the profile and the kept competitors, and emits one artifact per segment;
  // fails_when=segments are produced by the fast model, competitors are not passed, or artifacts are missing;
  // no_claim=fake model; quality is judged with the eval fixtures (#15).
  it('emits segments from the smart model', async () => {
    const llm = fakeLlm([okJson({ segments: [segment('A', 40), segment('B', 30), segment('C', 20), segment('D', 10)] })])
    const state: AnalysisState = { profile: PROFILE, competitors: [{ domain: 'xionmedia.in', name: 'Xion', reason: 'r', country: 'IN', countrySource: 'cctld' }] }
    const emitted: StepEmission[] = []
    const context: StepContext = { run: sampleRun(), emit: async (emission) => void emitted.push(emission) }
    await createSegmentsStep({ llm, models: { smart: 'model-smart', fast: 'model-fast' } }, state).execute(context)
    expect(llm.requests[0]?.model).toBe('model-smart')
    expect(llm.requests[0]?.turns[0]?.text).toContain('xionmedia.in')
    expect(emitted.map((e) => e.kind === 'artifact' && (e.data as IcpSegment).name)).toEqual(['A', 'B', 'C', 'D'])
    expect(state.segments?.reduce((sum, s) => sum + s.sharePct, 0)).toBe(100)
  })
})
