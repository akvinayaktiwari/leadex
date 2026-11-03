// Starts a free analysis run for a pasted website (#6). Rate limits, Turnstile and the 30-day domain cache are #7.
import { normalizeDomain } from '../lib/domain.js'
import type { AnalysisService, RunEngineService, StartAnalysisResult } from '../types/index.js'

export interface AnalysisServiceDeps {
  runEngine: Pick<RunEngineService, 'createRun'>
  enabled: boolean
}

export function createAnalysisService(deps: AnalysisServiceDeps): AnalysisService {
  return {
    async start(url: string): Promise<StartAnalysisResult> {
      if (!deps.enabled) return { ok: false, code: 'analyses_disabled' }
      const normalized = normalizeDomain(url)
      if (!normalized.ok) return { ok: false, code: normalized.reason }
      const run = await deps.runEngine.createRun({ type: 'analysis', domain: normalized.domain })
      return { ok: true, runId: run.runId, domain: run.domain }
    },
  }
}
