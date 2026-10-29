// Scheduled Fargate task: Leadex Data imports. Runs once and exits; EventBridge starts it on a schedule.
import { systemClock } from './src/lib/clock.js'
import { getIngestEnv } from './src/lib/env.js'
import { initSentry } from './src/lib/sentry.js'
import { createIngestRuntime } from './src/ingest-composition.js'
import { ingestExitCode, runIngestion } from './src/services/ingest-service.js'

const env = getIngestEnv()
initSentry('ingest', env)

const runtime = createIngestRuntime(env)
try {
  const summary = await runIngestion(env.INGEST_ENABLED, runtime.jobs, systemClock)
  process.exitCode = ingestExitCode(summary)
} finally {
  await runtime.close()
}
