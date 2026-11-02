export interface HealthStatus {
  status: 'ok'
  service: 'leadex-api'
  stage: 'dev' | 'staging' | 'prod'
  pipelineVersion: string
  time: string
}

export type ApiConnection =
  | { state: 'checking' }
  | { state: 'connected'; health: HealthStatus }
  | { state: 'unreachable'; reason: string }

export interface PublicConfig {
  apiUrl: string
  turnstileSiteKey: string
}

// ---- Analysis runs (mirror of the backend's run events and artifacts) ----

export type StepId = 'crawl' | 'profile' | 'competitors' | 'segments' | 'prospect' | 'qualify' | 'draft' | 'charge'
export type StepState = 'started' | 'completed' | 'failed'

export interface RunError {
  code: string
  message: string
}

export type RunEvent =
  | { seq: number; ts: string; kind: 'step'; step: StepId; state: StepState; label: string; durationMs?: number }
  | { seq: number; ts: string; kind: 'artifact'; step: StepId; artifact: 'profile' | 'competitor' | 'segment' | 'lead_batch'; data: unknown }
  | { seq: number; ts: string; kind: 'agent_note'; text: string }
  | { seq: number; ts: string; kind: 'end'; status: 'done' | 'failed'; error?: RunError }

export type ProfileClaimField = 'oneLiner' | 'category' | 'valueProp' | 'pricingSignal'

export interface ProfileClaim {
  field: ProfileClaimField
  text: string
  sourceUrl: string
}

export interface ProductProfile {
  domain: string
  name: string
  oneLiner: string
  valueProps: string[]
  category: string
  pricingSignals: string[]
  servedMarkets: string[]
  claims: ProfileClaim[]
  crawledAt: string
}

export interface Competitor {
  domain: string
  name: string
  reason: string
  country: string
  countrySource: 'structured_data' | 'phone' | 'cctld' | 'text'
}

export interface CompanyFilters {
  industries: string[]
  employeeMin: number
  employeeMax: number
  countries: string[]
  keywords: string[]
  technologies: string[]
}

export interface IcpSegment {
  segmentId: string
  name: string
  useCase: string
  pain: string
  criteria: string[]
  buyerTitles: string[]
  filters: CompanyFilters
  sharePct: number
}

export interface StepView {
  step: StepId
  label: string
  state: StepState
  durationMs?: number
}

export interface RunView {
  // Highest seq applied; events at or below it are ignored (no duplicates after a reconnect).
  lastSeq: number
  steps: StepView[]
  notes: string[]
  profile?: ProductProfile
  competitors: Competitor[]
  segments: IcpSegment[]
  end?: { status: 'done' | 'failed'; error?: RunError }
}
