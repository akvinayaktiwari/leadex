import { logInfo } from '../lib/logger.js'
import type { RunJobMessage } from '../types/index.js'

// Placeholder until the run engine (issue #3) dispatches real pipeline steps.
export async function handleRunJob(job: RunJobMessage): Promise<void> {
  logInfo('run job received', { runId: job.runId, type: job.type })
}
