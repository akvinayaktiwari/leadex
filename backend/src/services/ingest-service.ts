// Runs the scheduled Leadex Data imports (registries, open data). Sources are added by #22 and #23.
import { logError, logInfo } from '../lib/logger.js'
import { captureError } from '../lib/sentry.js'
import type { Clock, IngestJob, IngestJobOutcome, IngestSummary } from '../types/index.js'

async function runJob(job: IngestJob, clock: Clock): Promise<IngestJobOutcome> {
  const startedAt = clock.now().getTime()
  const durationMs = (): number => clock.now().getTime() - startedAt
  try {
    const result = await job.run()
    logInfo('ingest job done', { job: job.name, written: result.written, skipped: result.skipped, durationMs: durationMs() })
    return { name: job.name, ok: true, result, durationMs: durationMs() }
  } catch (error) {
    // One failing source must not stop the others; the failure is logged and reported in the summary.
    logError('ingest job failed', error, { job: job.name })
    captureError(error, { ingestJob: job.name })
    return { name: job.name, ok: false, error: error instanceof Error ? error.message : String(error), durationMs: durationMs() }
  }
}

// Jobs run one at a time so a slow source never competes with another for the same ClickHouse service.
export async function runIngestion(enabled: boolean, jobs: IngestJob[], clock: Clock): Promise<IngestSummary> {
  if (!enabled) {
    logInfo('ingest disabled (INGEST_ENABLED is not true); nothing to do')
    return { enabled: false, outcomes: [] }
  }
  if (jobs.length === 0) logInfo('ingest enabled but no jobs are registered yet')
  const outcomes: IngestJobOutcome[] = []
  for (const job of jobs) outcomes.push(await runJob(job, clock))
  return { enabled: true, outcomes }
}

export function ingestExitCode(summary: IngestSummary): number {
  return summary.outcomes.some((outcome) => !outcome.ok) ? 1 : 0
}
