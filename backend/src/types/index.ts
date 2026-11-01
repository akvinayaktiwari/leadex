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

export type SentryRuntime = 'api' | 'stream' | 'worker' | 'ingest'

// What Sentry setup reads; ApiEnv and IngestEnv both satisfy it.
export interface SentryEnv {
  STAGE: Stage
  SENTRY_DSN?: string | undefined
  PIPELINE_VERSION?: string | undefined
}

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
  // Read from the raw HTML before text extraction (scripts and JSON-LD are stripped from `text`).
  signals?: PageSignals | undefined
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

// ---- Leadex Data (own lead database, ClickHouse) ----

export interface LeadDataEnv {
  CLICKHOUSE_URL: string
  CLICKHOUSE_USER: string
  CLICKHOUSE_PASSWORD: string
  CLICKHOUSE_DATABASE: string
}

export interface IngestEnv extends LeadDataEnv {
  STAGE: Stage
  INGEST_ENABLED: boolean
  SENTRY_DSN?: string | undefined
  // Common Crawl domain-level ranks file for the release to import; the job is skipped when unset.
  CC_DOMAIN_RANKS_URL?: string | undefined
  INGEST_CC_MAX_DOMAINS: number
  // Company profiler: 0 (the default) turns it off. When above 0, the model settings below are required.
  INGEST_PROFILE_MAX_PER_RUN: number
  INGEST_PROFILE_CONCURRENCY: number
  ANTHROPIC_API_KEY?: string | undefined
  LLM_MODEL_FAST?: string | undefined
  // Used in the crawler's user agent so site owners can find out who we are.
  FRONTEND_URL?: string | undefined
  // Optional, for cost logging: USD per million input / output tokens of LLM_MODEL_FAST.
  LLM_FAST_INPUT_USD_PER_MTOK?: number | undefined
  LLM_FAST_OUTPUT_USD_PER_MTOK?: number | undefined
  // GLEIF golden-copy publishes API; the GLEIF import and matching jobs run only when it is set.
  GLEIF_API_URL?: string | undefined
  // Public page for one LEI (the LEI is appended); required with GLEIF_API_URL.
  GLEIF_RECORD_URL_BASE?: string | undefined
  INGEST_GLEIF_MATCH_PER_RUN: number
}

export type EntityType = 'company' | 'person'

export type FactSource =
  | 'website'
  | 'web_search'
  | 'gleif'
  | 'sec_edgar'
  | 'india_company_master'
  | 'mca_director'
  | 'us_state_registry'
  | 'web_data_commons'
  | 'pdl'

export type FactMethod = 'registry' | 'structured_data' | 'page_extract' | 'vendor'

// How far we may keep and reuse a fact: our own extraction, an open-data licence,
// an official public record, or a vendor's licence terms.
export type LicenceScope = 'owned' | 'open_data' | 'public_record' | 'vendor_licensed'

export type EmployeeBand = '1-10' | '11-50' | '51-200' | '201-500' | '501-1000' | '1001-5000' | '5001+'

export interface CompanyRecord {
  companyId: string
  domain: string
  name: string
  legalName?: string | undefined
  lei?: string | undefined
  description?: string | undefined
  industry?: string | undefined
  keywords: string[]
  employeeBand?: EmployeeBand | undefined
  // ISO-3166 alpha-2. Required: a record we cannot place in a country is never stored.
  country: string
  region?: string | undefined
  city?: string | undefined
  technologies: string[]
  servedMarkets: string[]
  updatedAt: string
}

export interface PersonRecord {
  personKey: string
  domain: string
  firstName: string
  lastName: string
  title: string
  seniority?: string | undefined
  department?: string | undefined
  country: string
  isOfficer: boolean
  updatedAt: string
}

// The record fields a fact can back. Ids and timestamps are derived, not claimed by a source.
export type CompanyField = Exclude<keyof CompanyRecord, 'companyId' | 'updatedAt'>
export type PersonField = Exclude<keyof PersonRecord, 'personKey' | 'updatedAt'>

export interface FactInput<F extends string = string> {
  field: F
  value: string
  source: FactSource
  sourceUrl: string
  method: FactMethod
  licenceScope: LicenceScope
  retrievedAt: string
}

export interface Fact extends FactInput {
  entityType: EntityType
  entityId: string
}

export type CompanyDraft = Omit<CompanyRecord, 'companyId' | 'updatedAt'>
export type PersonDraft = Omit<PersonRecord, 'personKey' | 'updatedAt'>

// Signals are stored as facts on the company ("signal.google_ads" = "true"), with their own source URL.
export type CompanySignalField = `signal.${string}`

export interface CompanyWrite {
  company: CompanyDraft
  facts: FactInput<CompanyField | CompanySignalField>[]
}

export interface PersonWrite {
  person: PersonDraft
  facts: FactInput<PersonField>[]
}

export type WriteOutcome =
  | { status: 'saved'; entityId: string }
  | { status: 'suppressed'; entityId: string }
  | { status: 'not_found'; entityId: string }

// Fields of a stored company that a later source may add or correct; identity (domain) never changes.
export type CompanyChanges = Partial<Omit<CompanyDraft, 'domain'>>

export interface CompanyEnrichment {
  domain: string
  changes: CompanyChanges
  facts: FactInput<CompanyField | CompanySignalField>[]
}

export type SuppressionKind = 'person' | 'email' | 'domain'

export type SuppressionReason = 'removal_request' | 'opt_out' | 'manual'

export interface SuppressionEntry {
  kind: SuppressionKind
  valueHash: string
  reason: SuppressionReason
  createdAt: string
}

export interface CompanySearchQuery {
  countries: string[]
  // Always applied by the repository, so a caller can never forget it.
  excludedCountries: string[]
  industries: string[]
  employeeBands: EmployeeBand[]
  // Lowercase; a company matches if it has any of them.
  keywords: string[]
  technologies: string[]
  limit: number
}

export interface PeopleSearchQuery {
  domains: string[]
  excludedCountries: string[]
  // Case-insensitive substrings of the title; empty means any title.
  titleTerms: string[]
  limit: number
}

export interface CompanyFilters {
  industries: string[]
  employeeMin: number
  employeeMax: number
  countries: string[]
  keywords: string[]
  technologies: string[]
}

export interface LeadDataRepository {
  insertCompanies(companies: CompanyRecord[]): Promise<void>
  insertPeople(people: PersonRecord[]): Promise<void>
  insertFacts(facts: Fact[]): Promise<void>
  searchCompanies(query: CompanySearchQuery): Promise<CompanyRecord[]>
  searchPeople(query: PeopleSearchQuery): Promise<PersonRecord[]>
  listFacts(entityType: EntityType, entityIds: string[]): Promise<Fact[]>
  findCompaniesByDomain(domains: string[]): Promise<CompanyRecord[]>
  // Companies with a legal name but no LEI yet, most recently updated first (for GLEIF matching).
  companiesWithoutLei(limit: number): Promise<CompanyRecord[]>
  insertSuppression(entries: SuppressionEntry[]): Promise<void>
  // Returns the subset of the given hashes that are suppressed.
  findSuppressed(kind: SuppressionKind, valueHashes: string[]): Promise<Set<string>>
}

export interface LeadDataSchemaRepository {
  ensureDatabase(): Promise<void>
  appliedMigrations(): Promise<Set<string>>
  applyMigration(name: string, statements: string[], appliedAt: string): Promise<void>
}

export interface MigrationFile {
  name: string
  sql: string
}

export interface DeliverableCompany {
  company: CompanyRecord
  facts: Fact[]
}

export interface DeliverablePerson {
  person: PersonRecord
  facts: Fact[]
}

export interface LeadDataService {
  saveCompany(write: CompanyWrite): Promise<WriteOutcome>
  savePerson(write: PersonWrite): Promise<WriteOutcome>
  // Adds or corrects fields of a stored company; each changed field needs a fact in `facts`.
  enrichCompany(enrichment: CompanyEnrichment): Promise<WriteOutcome>
  companiesWithoutLei(limit: number): Promise<CompanyRecord[]>
  findCompanies(filters: CompanyFilters, limit: number): Promise<CompanyRecord[]>
  findPeople(domains: string[], titleTerms: string[], limit: number): Promise<PersonRecord[]>
  // For delivery: every populated field must be backed by a fact, or this throws LeadDataRuleError (missing_provenance).
  loadDeliverableCompanies(companies: CompanyRecord[]): Promise<DeliverableCompany[]>
  loadDeliverablePeople(people: PersonRecord[]): Promise<DeliverablePerson[]>
  suppress(kind: SuppressionKind, value: string, reason: SuppressionReason): Promise<void>
}

export interface IngestJobResult {
  written: number
  skipped: number
}

export interface IngestJob {
  name: string
  run(): Promise<IngestJobResult>
}

export type IngestJobOutcome =
  | { name: string; ok: true; result: IngestJobResult; durationMs: number }
  | { name: string; ok: false; error: string; durationMs: number }

export interface IngestSummary {
  enabled: boolean
  outcomes: IngestJobOutcome[]
}

// ---- Company discovery from open data (#22) ----

// One line of the Common Crawl domain-ranks file, parsed.
export interface DomainRankLine {
  harmonicRank: number
  harmonicValue: number
  pagerankRank: number
  reversedDomain: string
  hosts: number
}

export interface DomainCandidate {
  domain: string
  tld: string
  harmonicRank: number
  harmonicValue: number
  pagerankRank: number
  hosts: number
  release: string
  importedAt: string
}

export interface DomainRanksSource {
  // Streams parsed lines in file order (best-linked first). Breaking out of the loop closes the download.
  streamDomainRanks(url: string): AsyncIterable<DomainRankLine>
}

export interface DomainCandidatesRepository {
  insertCandidates(candidates: DomainCandidate[]): Promise<void>
  countForRelease(release: string): Promise<number>
}

export interface DomainImportOptions {
  url: string
  maxDomains: number
  batchSize: number
}

// ---- Company profiler (#22 part 2) ----

export type TechnologyName =
  | 'google_analytics' | 'google_tag_manager' | 'google_ads' | 'meta_pixel' | 'linkedin_insight' | 'hubspot'
  | 'salesforce_pardot' | 'marketo' | 'segment' | 'hotjar' | 'intercom' | 'zendesk' | 'drift' | 'calendly' | 'stripe'
  | 'shopify' | 'woocommerce' | 'wordpress' | 'wix' | 'squarespace' | 'webflow' | 'nextjs'

export type JobBoardProvider = 'greenhouse' | 'lever' | 'ashby' | 'workable'

export interface JobBoardLink {
  provider: JobBoardProvider
  board: string
  url: string
}

// Business details a site publishes as schema.org JSON-LD (Organization, LocalBusiness, …).
export interface StructuredOrganization {
  name?: string | undefined
  legalName?: string | undefined
  telephone?: string | undefined
  country?: string | undefined
  region?: string | undefined
  city?: string | undefined
  foundingDate?: string | undefined
}

export interface AgencyCredit {
  name: string
  url?: string | undefined
  // Only explicit design/build credits ("Website by …") are recorded, at 0.9.
  confidence: number
}

export interface PageSignals {
  technologies: TechnologyName[]
  organization?: StructuredOrganization | undefined
  hasStructuredData: boolean
  agency?: AgencyCredit | undefined
  jobBoards: JobBoardLink[]
}

export interface ProfileCandidate {
  domain: string
  harmonicRank: number
  attempts: number
}

export type CrawlOutcome = 'profiled' | 'skipped' | 'failed'

export type ProfileSkipReason =
  | 'not_a_business' | 'unknown_country' | 'blocked_country' | 'redirects_elsewhere' | 'robots_disallowed'
  | 'site_unreadable' | 'suppressed' | 'no_provenance'

export type ProfileFailReason = 'unreachable' | 'llm_failed' | 'error'

export interface CrawlStatusEntry {
  domain: string
  status: CrawlOutcome
  reason: ProfileSkipReason | ProfileFailReason | ''
  attempts: number
  checkedAt: string
}

export interface ProfileSelection {
  limit: number
  excludedDomains: string[]
  maxAttempts: number
  // Failed domains are retried only after this time; profiled ones are refreshed only before refreshBefore.
  retryFailedBefore: string
  refreshProfiledBefore: string
}

export interface CrawlStatusRepository {
  nextToProfile(selection: ProfileSelection): Promise<ProfileCandidate[]>
  recordStatus(entries: CrawlStatusEntry[]): Promise<void>
}

export interface ProfilerUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
}

export interface ProfileBatchSummary {
  attempted: number
  profiled: number
  skipped: Partial<Record<ProfileSkipReason, number>>
  failed: Partial<Record<ProfileFailReason, number>>
  usage: ProfilerUsage
  // Present when model prices are configured.
  costUsd?: number | undefined
}

export interface LlmPrices {
  inputUsdPerMillion: number
  outputUsdPerMillion: number
}

// ---- GLEIF legal entities (#22 part 3) ----

export interface GleifRecord {
  lei: string
  legalName: string
  otherNames: string[]
  legalCountry: string
  legalCity: string
  hqCountry: string
  hqCity: string
  jurisdiction: string
  category: string
  legalForm: string
  entityStatus: string
  registrationStatus: string
}

export interface GleifPublish {
  publishDate: string
  fullCsvUrl: string
  fullRecords: number
  // Changes published in the last day; applied daily after the full file.
  lastDayCsvUrl: string
}

export interface GleifSource {
  latestPublish(): Promise<GleifPublish>
  // Streams records from a golden-copy CSV zip. Breaking out of the loop stops the download.
  streamRecords(zipUrl: string): AsyncIterable<GleifRecord>
}

export interface LegalEntityNameRow {
  nameKey: string
  lei: string
  legalCountry: string
  hqCountry: string
  entityStatus: string
  registrationStatus: string
  publishDate: string
}

export type GleifImportKind = 'full' | 'delta'

export interface GleifImportRecord {
  kind: GleifImportKind
  publishDate: string
  records: number
  importedAt: string
}

export interface LegalEntitiesRepository {
  insertEntities(records: GleifRecord[], publishDate: string): Promise<void>
  insertNames(rows: LegalEntityNameRow[]): Promise<void>
  // Most recent import of the kind, if any.
  latestImport(kind: GleifImportKind): Promise<GleifImportRecord | undefined>
  hasImport(kind: GleifImportKind, publishDate: string): Promise<boolean>
  recordImport(record: GleifImportRecord): Promise<void>
  findNames(nameKeys: string[]): Promise<LegalEntityNameRow[]>
}

export type LegalMatchOutcome = 'matched' | 'no_match' | 'ambiguous'

export interface LegalMatchSummary {
  checked: number
  matched: number
  noMatch: number
  ambiguous: number
}
