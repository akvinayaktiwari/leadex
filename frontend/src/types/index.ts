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
