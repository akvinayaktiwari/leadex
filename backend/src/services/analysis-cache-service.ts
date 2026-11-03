// Keeps each completed analysis for 30 days per (domain, pipeline version), so a repeat request replays it with no
// crawl, model or data calls (acceptance criterion 2).
import { logInfo } from '../lib/logger.js'
import type { AnalysisCacheRepository, AnalysisCacheService, Clock, RunEvent, RunEventsRepository, RunRecord } from '../types/index.js'

export const ANALYSIS_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
// An analysis emits a few dozen events; this bounds a runaway run.
const MAX_CACHED_EVENTS = 500

export interface AnalysisCacheDeps {
  cache: AnalysisCacheRepository
  events: RunEventsRepository
  clock: Clock
  pipelineVersion: string
}

async function eventsWithoutEnd(deps: AnalysisCacheDeps, runId: string): Promise<RunEvent[] | undefined> {
  const events = await deps.events.listAfter(runId, 0, MAX_CACHED_EVENTS + 1)
  if (events.length <= MAX_CACHED_EVENTS) return events.filter((event) => event.kind !== 'end')
  logInfo('analysis not cached: too many events', { runId, limit: MAX_CACHED_EVENTS })
  return undefined
}

export function createAnalysisCacheService(deps: AnalysisCacheDeps): AnalysisCacheService {
  return {
    async saveFromRun(run: RunRecord): Promise<void> {
      if (run.type !== 'analysis') return
      const events = await eventsWithoutEnd(deps, run.runId)
      if (!events) return
      const now = deps.clock.now()
      await deps.cache.put({
        domain: run.domain, pipelineVersion: deps.pipelineVersion, sourceRunId: run.runId, events,
        createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + ANALYSIS_CACHE_TTL_MS).toISOString(),
      })
    },
  }
}
