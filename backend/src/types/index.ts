export type Stage = 'dev' | 'staging' | 'prod'

export interface ApiEnv {
  STAGE: Stage
  AWS_REGION: string
  FRONTEND_URL: string
  PIPELINE_VERSION: string
  SENTRY_DSN?: string | undefined
}

export interface WorkerEnv extends ApiEnv {
  SQS_RUNS_QUEUE_URL: string
}

export interface HealthStatus {
  status: 'ok'
  service: 'leadex-api'
  stage: Stage
  pipelineVersion: string
  time: string
}

export interface ApiErrorBody {
  error: {
    code: string
    message: string
  }
}

export type RunType = 'analysis' | 'lead_build'

export interface RunJobMessage {
  runId: string
  type: RunType
}

export interface QueueMessage {
  receiptHandle: string
  body: string
}

export interface RunQueueRepository {
  receive(maxMessages: number, waitSeconds: number): Promise<QueueMessage[]>
  remove(receiptHandle: string): Promise<void>
}

export type RunJobHandler = (job: RunJobMessage) => Promise<void>

export type SentryRuntime = 'api' | 'stream' | 'worker'

export type LogFields = Record<string, string | number | boolean | null>

export interface SourceFile {
  path: string
  source: string
}

export interface LayerViolation {
  file: string
  importPath: string
  rule: string
}
