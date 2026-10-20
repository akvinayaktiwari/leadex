import { getApiEnv } from '../lib/env.js'
import type { HealthStatus } from '../types/index.js'

export function getHealth(now: Date = new Date()): HealthStatus {
  const env = getApiEnv()
  return {
    status: 'ok',
    service: 'leadex-api',
    stage: env.STAGE,
    pipelineVersion: env.PIPELINE_VERSION,
    time: now.toISOString(),
  }
}
