import { beforeEach, describe, expect, it } from 'vitest'
import { resetEnvCacheForTests } from '../src/lib/env.js'
import { createApp } from '../src/routes/index.js'
import type { ApiErrorBody, HealthStatus } from '../src/types/index.js'

const FRONTEND_URL = 'http://localhost:3000'

function setTestEnv(): void {
  process.env.STAGE = 'dev'
  process.env.AWS_REGION = 'ap-south-1'
  process.env.FRONTEND_URL = FRONTEND_URL
  process.env.PIPELINE_VERSION = '1'
  delete process.env.SENTRY_DSN
}

describe('health and error routes', () => {
  beforeEach(() => {
    setTestEnv()
    resetEnvCacheForTests()
  })

  // protects=GET /api/health returns 200 with stage and pipelineVersion from env;
  // fails_when=route missing, wrong status, or values hardcoded instead of read from env;
  // no_claim=does not prove the Lambda adapter or Function URL wiring.
  it('returns health from env', async () => {
    const response = await createApp().request('/api/health')
    expect(response.status).toBe(200)
    const body = (await response.json()) as HealthStatus
    expect(body).toMatchObject({ status: 'ok', service: 'leadex-api', stage: 'dev', pipelineVersion: '1' })
  })

  // protects=unknown routes return a JSON 404 error body;
  // fails_when=Hono's default text 404 leaks out;
  // no_claim=does not cover 405 handling.
  it('returns a JSON 404 for unknown routes', async () => {
    const response = await createApp().request('/api/nope')
    expect(response.status).toBe(404)
    const body = (await response.json()) as ApiErrorBody
    expect(body.error.code).toBe('not_found')
  })

  // protects=CORS allows only FRONTEND_URL;
  // fails_when=wildcard origin or no CORS header for the frontend;
  // no_claim=does not test preflight for every method.
  it('allows CORS only for the configured frontend', async () => {
    const allowed = await createApp().request('/api/health', { headers: { Origin: FRONTEND_URL } })
    expect(allowed.headers.get('access-control-allow-origin')).toBe(FRONTEND_URL)
    const other = await createApp().request('/api/health', { headers: { Origin: 'https://evil.example' } })
    expect(other.headers.get('access-control-allow-origin')).not.toBe('https://evil.example')
  })

  // protects=startup fails loudly on missing config;
  // fails_when=app boots with undefined FRONTEND_URL;
  // no_claim=does not enumerate every variable.
  it('throws a clear error when required env is missing', () => {
    delete process.env.FRONTEND_URL
    resetEnvCacheForTests()
    expect(() => createApp()).toThrow(/FRONTEND_URL/)
  })
})
