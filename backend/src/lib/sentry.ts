import * as Sentry from '@sentry/node'
import type { SentryEnv, SentryRuntime } from '../types/index.js'

let initialized = false

export function initSentry(runtime: SentryRuntime, env: SentryEnv): void {
  if (initialized || !env.SENTRY_DSN) return
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.STAGE,
    ...(env.PIPELINE_VERSION ? { release: env.PIPELINE_VERSION } : {}),
    initialScope: { tags: { runtime } },
  })
  initialized = true
}

export function captureError(error: unknown, tags: Record<string, string> = {}): void {
  if (!initialized) return
  Sentry.captureException(error, { tags })
}
