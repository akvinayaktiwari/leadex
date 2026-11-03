// Starts a free analysis for a pasted website (#6). A completed analysis of the same domain and pipeline version from
// the last 30 days is replayed instead of run again (#7).
import { normalizeDomain } from '../lib/domain.js'
import type { AnalysisCacheRepository, AnalysisService, Clock, RunEngineService, RunRecord, StartAnalysisResult } from '../types/index.js'

export interface AnalysisServiceDeps {
  runEngine: Pick<RunEngineService, 'createRun' | 'createReplayedRun'>
  cache: AnalysisCacheRepository
  clock: Clock
  pipelineVersion: string
  enabled: boolean
}

// A replayed run when a fresh cached analysis exists, otherwise undefined.
async function replayFromCache(deps: AnalysisServiceDeps, domain: string): Promise<RunRecord | undefined> {
  const cached = await deps.cache.get(domain, deps.pipelineVersion)
  if (!cached || Date.parse(cached.expiresAt) <= deps.clock.now().getTime()) return undefined
  return deps.runEngine.createReplayedRun({ type: 'analysis', domain }, cached.events)
}

export function createAnalysisService(deps: AnalysisServiceDeps): AnalysisService {
  return {
    async start(url: string): Promise<StartAnalysisResult> {
      if (!deps.enabled) return { ok: false, code: 'analyses_disabled' }
      const normalized = normalizeDomain(url)
      if (!normalized.ok) return { ok: false, code: normalized.reason }
      const replayed = await replayFromCache(deps, normalized.domain)
      if (replayed) return { ok: true, runId: replayed.runId, domain: replayed.domain, cached: true }
      const run = await deps.runEngine.createRun({ type: 'analysis', domain: normalized.domain })
      return { ok: true, runId: run.runId, domain: run.domain, cached: false }
    },
  }
}
