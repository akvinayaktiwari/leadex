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
  CC_DOMAIN_RANKS_URL: z.url().optional(),
  // How many domains (best-linked first, after filtering) to keep from one release.
  INGEST_CC_MAX_DOMAINS: z.coerce.number().int().min(1).max(130_000_000).default(2_000_000),
  INGEST_PROFILE_MAX_PER_RUN: z.coerce.number().int().min(0).max(1_000_000).default(0),
  INGEST_PROFILE_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(8),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  LLM_MODEL_FAST: z.string().min(1).optional(),
  FRONTEND_URL: z.url().optional(),
  LLM_FAST_INPUT_USD_PER_MTOK: z.coerce.number().min(0).optional(),
  LLM_FAST_OUTPUT_USD_PER_MTOK: z.coerce.number().min(0).optional(),
  GLEIF_API_URL: z.url().optional(),
  GLEIF_RECORD_URL_BASE: z.url().optional(),
  INGEST_GLEIF_MATCH_PER_RUN: z.coerce.number().int().min(1).max(1_000_000).default(5_000),
  INGEST_PEOPLE_MAX_PER_RUN: z.coerce.number().int().min(0).max(1_000_000).default(0),
  INGEST_PEOPLE_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(8),
}).superRefine((env, context) => {
  if (env.GLEIF_API_URL && !env.GLEIF_RECORD_URL_BASE) {
    context.addIssue({ code: 'custom', path: ['GLEIF_RECORD_URL_BASE'], message: 'required when GLEIF_API_URL is set' })
  }
  // The profiler and the people extractor both call the fast model.
  const usesModel = env.INGEST_PROFILE_MAX_PER_RUN > 0 || env.INGEST_PEOPLE_MAX_PER_RUN > 0
  if (!usesModel) return
  for (const name of ['ANTHROPIC_API_KEY', 'LLM_MODEL_FAST', 'FRONTEND_URL'] as const) {
    if (!env[name]) context.addIssue({ code: 'custom', path: [name], message: 'required when INGEST_PROFILE_MAX_PER_RUN or INGEST_PEOPLE_MAX_PER_RUN > 0' })
  }
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
