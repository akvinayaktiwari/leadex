import type { ZodType } from 'zod'

export type Stage = 'dev' | 'staging' | 'prod'

export interface ApiEnv {
  STAGE: Stage
  AWS_REGION: string
  FRONTEND_URL: string
  PIPELINE_VERSION: string
  SENTRY_DSN?: string | undefined
}

export interface RunStoreEnv {
  AWS_REGION: string
  TABLE_RUNS: string
  TABLE_RUN_EVENTS: string
  SQS_RUNS_QUEUE_URL: string
  DYNAMODB_ENDPOINT?: string | undefined
}

export interface WorkerEnv extends ApiEnv, RunStoreEnv {
  ANTHROPIC_API_KEY: string
  LLM_MODEL_SMART: string
  LLM_MODEL_FAST: string
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
  send(job: RunJobMessage): Promise<void>
}

export type RunJobHandler = (job: RunJobMessage) => Promise<void>

// ---- Run engine ----

export type RunStatus = 'queued' | 'running' | 'done' | 'failed'

export type StepId =
  | 'crawl'
  | 'profile'
  | 'competitors'
  | 'segments'
  | 'prospect'
  | 'qualify'
  | 'draft'
  | 'charge'

export type StepState = 'started' | 'completed' | 'failed'

export type ArtifactKind = 'profile' | 'competitor' | 'segment' | 'lead_batch'

export interface RunErrorInfo {
  code: string
  message: string
}

export interface RunRecord {
  runId: string
  type: RunType
  domain: string
  userId?: string | undefined
  status: RunStatus
  createdAt: string
  updatedAt: string
  error?: RunErrorInfo | undefined
}

export interface StepEventBody {
  kind: 'step'
  step: StepId
  state: StepState
  label: string
  durationMs?: number | undefined
}

export interface ArtifactEventBody {
  kind: 'artifact'
  step: StepId
  artifact: ArtifactKind
  // Validated per artifact kind by the step that emits it (zod schemas in lib/schemas.ts).
  data: unknown
}

export interface AgentNoteEventBody {
  kind: 'agent_note'
  text: string
}

export interface EndEventBody {
  kind: 'end'
  status: 'done' | 'failed'
  error?: RunErrorInfo | undefined
}

export type RunEventBody = StepEventBody | ArtifactEventBody | AgentNoteEventBody | EndEventBody

export type RunEvent = RunEventBody & { seq: number; ts: string }

// What a pipeline step may emit itself; step and end events belong to the engine.
export type StepEmission = ArtifactEventBody | AgentNoteEventBody

export interface RunsRepository {
  create(run: RunRecord): Promise<void>
  get(runId: string): Promise<RunRecord | undefined>
  setStatus(runId: string, status: RunStatus, updatedAt: string, error?: RunErrorInfo): Promise<void>
}

export interface RunEventsRepository {
  // Fails if an event with the same seq already exists for the run.
  append(runId: string, event: RunEvent): Promise<void>
  listAfter(runId: string, afterSeq: number, limit: number): Promise<RunEvent[]>
  // 0 when the run has no events.
  lastSeq(runId: string): Promise<number>
}

export interface StepContext {
  run: RunRecord
  emit(emission: StepEmission): Promise<void>
}

export interface PipelineStep {
  id: StepId
  label: string
  execute(context: StepContext): Promise<void>
}

// A factory per run, so a pipeline's steps can share typed state through a closure.
export type PipelineFactory = (run: RunRecord) => PipelineStep[]

export type PipelineRegistry = Partial<Record<RunType, PipelineFactory>>

export interface Clock {
  now(): Date
}

export interface CreateRunInput {
  type: RunType
  domain: string
  userId?: string | undefined
}

export interface RunEngineService {
  createRun(input: CreateRunInput): Promise<RunRecord>
  executeRun(job: RunJobMessage): Promise<void>
}

export interface RunEventSink {
  send(event: RunEvent): Promise<void>
  heartbeat(): Promise<void>
  isClosed(): boolean
}

export type RunStreamEnd = 'ended' | 'timeout' | 'client_closed'

export type RunAccess = { ok: true; run: RunRecord } | { ok: false }

export interface RunStreamService {
  authorize(runId: string, requesterUserId: string | undefined): Promise<RunAccess>
  stream(runId: string, afterSeq: number, sink: RunEventSink): Promise<RunStreamEnd>
}

export interface RunStreamOptions {
  pollMs: number
  heartbeatMs: number
  maxDurationMs: number
  pageSize: number
}

export interface ApiServices {
  runStream: RunStreamService
}

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

// ---- Analysis pipeline ----

export interface ProductProfile {
  domain: string
  name: string
  oneLiner: string
  valueProps: string[]
  category: string
  pricingSignals: string[]
  // ISO-3166 alpha-2 codes, or ['GLOBAL'].
  servedMarkets: string[]
}

export interface CrawledPage {
  url: string
  path: string
  title: string
  description: string
  text: string
}

export interface CrawledSite {
  domain: string
  origin: string
  pages: CrawledPage[]
  blockedByRobots: number
  failedPages: number
}

// Shared by the steps of one analysis run (one instance per run, created by the pipeline factory).
export interface AnalysisState {
  site?: CrawledSite | undefined
  profile?: ProductProfile | undefined
}

export type FetchFailure = 'blocked_host' | 'timeout' | 'http_error' | 'unsupported_type' | 'too_large' | 'network'

export type FetchResult =
  | { ok: true; finalUrl: string; status: number; body: string }
  | { ok: false; reason: FetchFailure; status?: number | undefined }

export interface FetchRequest {
  url: string
  accept: 'html' | 'text'
  timeoutMs: number
}

export interface SiteFetchRepository {
  fetchText(request: FetchRequest): Promise<FetchResult>
}

export type LlmEffort = 'low' | 'medium' | 'high'

export interface LlmTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface LlmJsonRequest {
  model: string
  system: string
  turns: LlmTurn[]
  // Sent to the model as the output JSON schema; the caller still validates the result.
  schema: ZodType
  maxTokens: number
  effort: LlmEffort
}

export interface LlmUsage {
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
}

export type LlmJsonResponse =
  | { ok: true; value: unknown; rawText: string; usage: LlmUsage }
  | { ok: false; reason: 'refusal' | 'truncated' | 'not_json'; rawText: string; usage: LlmUsage }

export interface LlmRepository {
  generateJson(request: LlmJsonRequest): Promise<LlmJsonResponse>
}

export interface LlmModels {
  smart: string
  fast: string
}
