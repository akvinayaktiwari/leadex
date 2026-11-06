import { describe, expect, it } from 'vitest'
import { ANALYSIS_CACHE_TTL_MS } from '../src/services/analysis-cache-service.js'
import { MAX_LEADS_PER_BUILD, createLeadBuildService } from '../src/services/lead-build-service.js'
import { createRunEngineService } from '../src/services/run-engine-service.js'
import type { RunEvent } from '../src/types/index.js'
import { manualClock, memoryAnalysisCache, memoryEvents, memoryQueue, memoryRuns } from './support/in-memory-run-store.js'

const TS = '2026-10-21T10:00:00.000Z'
const segment = (segmentId: string) => ({
  segmentId, name: segmentId, useCase: 'u', pain: 'p', criteria: ['c'], buyerTitles: ['CEO'], sharePct: 50,
  filters: { industries: ['real_estate'], employeeMin: 10, employeeMax: 200, countries: ['IN'], keywords: [], technologies: [] },
})
const PROFILE = { domain: 'seller.com', name: 'Seller', oneLiner: 'x', valueProps: [], category: 'c', pricingSignals: [], servedMarkets: ['IN'], claims: [], crawledAt: TS }
const EVENTS: RunEvent[] = [
  { seq: 1, ts: TS, kind: 'artifact', step: 'profile', artifact: 'profile', data: PROFILE },
  { seq: 2, ts: TS, kind: 'artifact', step: 'segments', artifact: 'segment', data: segment('villas') },
  { seq: 3, ts: TS, kind: 'artifact', step: 'segments', artifact: 'segment', data: segment('plots') },
]

async function setup() {
  const clock = manualClock()
  const runs = memoryRuns()
  const queue = memoryQueue()
  const cache = memoryAnalysisCache()
  await cache.put({ domain: 'seller.com', pipelineVersion: '1', sourceRunId: 'run_a', events: EVENTS, createdAt: TS, expiresAt: new Date(Date.parse(TS) + ANALYSIS_CACHE_TTL_MS).toISOString() })
  const runEngine = createRunEngineService({ runs, events: memoryEvents(), queue, pipelines: {}, clock, newId: () => 'run_build' })
  return { clock, runs, queue, service: createLeadBuildService({ runEngine, cache, clock, pipelineVersion: '1' }) }
}

describe('starting a lead build', () => {
  // protects=a build uses the profile and segment filters from the user's cached analysis (the request only picks segment
  // ids and a count), is owned by the user, and is queued;
  // fails_when=a client could inject its own search filters, the run has no owner, or no job is queued;
  // no_claim=in-memory cache and run store.
  it('builds from the cached analysis', async () => {
    const { service, runs, queue } = await setup()
    expect(await service.start({ userId: 'user_1', url: 'https://www.seller.com/', segmentIds: ['plots'], leadCount: 25 })).toEqual({ ok: true, runId: 'run_build' })
    const run = await runs.get('run_build')
    expect(run).toMatchObject({ type: 'lead_build', domain: 'seller.com', userId: 'user_1', leadBuild: { leadCount: 25, profile: { name: 'Seller' } } })
    expect(run?.leadBuild?.segments.map((item) => item.segmentId)).toEqual(['plots'])
    expect(run?.leadBuild?.segments[0]?.filters.industries).toEqual(['real_estate'])
    expect(queue.sent).toEqual([{ runId: 'run_build', type: 'lead_build' }])
  })

  // protects=bad requests are refused before any run exists: no analysis for the domain (or an expired one), a segment id
  // that isn't in it, or a lead count outside 1..500;
  // fails_when=a build starts without an analysis, silently drops an unknown segment, or accepts 0 or 10,000 leads;
  // no_claim=n/a.
  it('refuses bad requests', async () => {
    const { service, queue, clock } = await setup()
    const base = { userId: 'user_1', url: 'seller.com', segmentIds: ['villas'], leadCount: 10 }
    expect(await service.start({ ...base, url: 'other.com' })).toEqual({ ok: false, code: 'analysis_not_found' })
    expect(await service.start({ ...base, segmentIds: ['villas', 'nope'] })).toEqual({ ok: false, code: 'unknown_segments' })
    expect(await service.start({ ...base, segmentIds: [] })).toEqual({ ok: false, code: 'unknown_segments' })
    expect(await service.start({ ...base, leadCount: 0 })).toEqual({ ok: false, code: 'invalid_lead_count' })
    expect(await service.start({ ...base, leadCount: MAX_LEADS_PER_BUILD + 1 })).toEqual({ ok: false, code: 'invalid_lead_count' })
    clock.advance(ANALYSIS_CACHE_TTL_MS)
    expect(await service.start(base)).toEqual({ ok: false, code: 'analysis_not_found' })
    expect(queue.sent).toEqual([])
  })
})
