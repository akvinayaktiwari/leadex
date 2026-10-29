import { z } from 'zod'
import type { ApiEnv, IngestEnv, LeadDataEnv, RunStoreEnv, WorkerEnv } from '../types/index.js'

const apiEnvSchema = z.object({
  STAGE: z.enum(['dev', 'staging', 'prod']),
  AWS_REGION: z.string().min(1),
  FRONTEND_URL: z.url(),
  PIPELINE_VERSION: z.string().min(1),
  SENTRY_DSN: z.string().optional(),
}) satisfies z.ZodType<ApiEnv>

const runStoreEnvSchema = z.object({
  AWS_REGION: z.string().min(1),
  TABLE_RUNS: z.string().min(1),
  TABLE_RUN_EVENTS: z.string().min(1),
  SQS_RUNS_QUEUE_URL: z.url(),
  // Local development and tests only (DynamoDB Local). Unset in AWS.
  DYNAMODB_ENDPOINT: z.url().optional(),
}) satisfies z.ZodType<RunStoreEnv>

const workerEnvSchema = apiEnvSchema.extend(runStoreEnvSchema.shape).extend({
  ANTHROPIC_API_KEY: z.string().min(1),
  LLM_MODEL_SMART: z.string().min(1),
  LLM_MODEL_FAST: z.string().min(1),
}) satisfies z.ZodType<WorkerEnv>

const leadDataEnvSchema = z.object({
  CLICKHOUSE_URL: z.url(),
  CLICKHOUSE_USER: z.string().min(1),
  CLICKHOUSE_PASSWORD: z.string().min(1),
  CLICKHOUSE_DATABASE: z.string().regex(/^[a-z][a-z0-9_]*$/, 'lowercase letters, digits and underscores'),
}) satisfies z.ZodType<LeadDataEnv>

const ingestEnvSchema = leadDataEnvSchema.extend({
  STAGE: z.enum(['dev', 'staging', 'prod']),
  // Off unless explicitly 'true', so a missing variable never starts imports.
  INGEST_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  SENTRY_DSN: z.string().optional(),
}) satisfies z.ZodType<IngestEnv, Record<string, unknown>>

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

export function getRunStoreEnv(source: NodeJS.ProcessEnv = process.env): RunStoreEnv {
  return parseEnv(runStoreEnvSchema, source)
}

export function getWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  return parseEnv(workerEnvSchema, source)
}

export function getLeadDataEnv(source: NodeJS.ProcessEnv = process.env): LeadDataEnv {
  return parseEnv(leadDataEnvSchema, source)
}

export function getIngestEnv(source: NodeJS.ProcessEnv = process.env): IngestEnv {
  return parseEnv(ingestEnvSchema, source)
}

export function resetEnvCacheForTests(): void {
  cachedApiEnv = undefined
}
