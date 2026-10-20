import * as Sentry from '@sentry/node'
import type { ApiEnv, SentryRuntime } from '../types/index.js'

let initialized = false

export function initSentry(runtime: SentryRuntime, env: ApiEnv): void {
  if (initialized || !env.SENTRY_DSN) return
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.STAGE,
    release: env.PIPELINE_VERSION,
    initialScope: { tags: { runtime } },
  })
  initialized = true
}

export function captureError(error: unknown, tags: Record<string, string> = {}): void {
  if (!initialized) return
  Sentry.captureException(error, { tags })
}
