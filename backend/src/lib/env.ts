import { z } from 'zod'
import type { ApiEnv, WorkerEnv } from '../types/index.js'

const apiEnvSchema = z.object({
  STAGE: z.enum(['dev', 'staging', 'prod']),
  AWS_REGION: z.string().min(1),
  FRONTEND_URL: z.url(),
  PIPELINE_VERSION: z.string().min(1),
  SENTRY_DSN: z.string().optional(),
}) satisfies z.ZodType<ApiEnv>

const workerEnvSchema = apiEnvSchema.extend({
  SQS_RUNS_QUEUE_URL: z.url(),
}) satisfies z.ZodType<WorkerEnv>

let cachedApiEnv: ApiEnv | undefined

function parseEnv<T>(schema: z.ZodType<T>, source: NodeJS.ProcessEnv): T {
  const result = schema.safeParse(source)
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join('.')).join(', ')
    throw new Error(`Invalid or missing environment variables: ${fields}`)
  }
  return result.data
}

export function getApiEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  cachedApiEnv ??= parseEnv(apiEnvSchema, source)
  return cachedApiEnv
}

export function getWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  return parseEnv(workerEnvSchema, source)
}

export function resetEnvCacheForTests(): void {
  cachedApiEnv = undefined
}
