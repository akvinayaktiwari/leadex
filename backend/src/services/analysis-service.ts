// Starts a free analysis for a pasted website (#6). Anonymous callers get a few per day per IP and per device (#7),
// and a completed analysis of the same domain and pipeline version from the last 30 days is replayed, not run again.
import { normalizeDomain } from '../lib/domain.js'
import { anonymousLimitKeys } from '../lib/rate-limit-keys.js'
import type {
  AnalysisCacheRepository,
  AnalysisService,
  Clock,
  RateLimitRepository,
  RunEngineService,
  RunRecord,
  StartAnalysisRequest,
  StartAnalysisResult,
} from '../types/index.js'

// Counters outlive their UTC day by a day, then DynamoDB deletes them.
const LIMIT_KEY_TTL_MS = 2 * 24 * 60 * 60 * 1000

export interface AnalysisServiceDeps {
  runEngine: Pick<RunEngineService, 'createRun' | 'createReplayedRun'>
  cache: AnalysisCacheRepository
  rateLimits: RateLimitRepository
  clock: Clock
  pipelineVersion: string
  dailyLimit: number
}

function withinLimits(deps: AnalysisServiceDeps, request: StartAnalysisRequest): Promise<boolean> {
  const now = deps.clock.now()
  const keys = anonymousLimitKeys(request.ip, request.deviceId, now)
  return deps.rateLimits.consume(keys, deps.dailyLimit, new Date(now.getTime() + LIMIT_KEY_TTL_MS).toISOString())
}

// A replayed run when a fresh cached analysis exists, otherwise undefined.
async function replayFromCache(deps: AnalysisServiceDeps, domain: string): Promise<RunRecord | undefined> {
  const cached = await deps.cache.get(domain, deps.pipelineVersion)
  if (!cached || Date.parse(cached.expiresAt) <= deps.clock.now().getTime()) return undefined
  return deps.runEngine.createReplayedRun({ type: 'analysis', domain }, cached.events)
}

export function createAnalysisService(deps: AnalysisServiceDeps): AnalysisService {
  return {
    async start(request: StartAnalysisRequest): Promise<StartAnalysisResult> {
      const normalized = normalizeDomain(request.url)
      if (!normalized.ok) return { ok: false, code: normalized.reason }
      if (!(await withinLimits(deps, request))) return { ok: false, code: 'rate_limited' }
      const replayed = await replayFromCache(deps, normalized.domain)
      if (replayed) return { ok: true, runId: replayed.runId, domain: replayed.domain, cached: true }
      const run = await deps.runEngine.createRun({ type: 'analysis', domain: normalized.domain })
      return { ok: true, runId: run.runId, domain: run.domain, cached: false }
    },
  }
}

// Until PUBLIC_ANALYSES_ENABLED is true, a deployed API cannot be used to run up model costs.
export const DISABLED_ANALYSIS_SERVICE: AnalysisService = { start: async () => ({ ok: false, code: 'analyses_disabled' }) }
