import { describe, expect, it } from 'vitest'
import { getAnalysesEnv, getIngestEnv } from '../src/lib/env.js'

describe('environment parsing', () => {
  // protects=an empty variable (KEY= in a .env copied from .env.example) counts as unset, so optional settings keep their
  // defaults and the app starts;
  // fails_when=APP_SECRET_ID= or BOUNCER_API_KEY= makes startup fail with "Invalid or missing environment variables";
  // no_claim=a required variable left empty still fails, as it should.
  it('treats empty values as unset', () => {
    const analyses = getAnalysesEnv({ TABLE_RATE_LIMITS: 't', TURNSTILE_VERIFY_URL: 'https://verify.example', TURNSTILE_SECRET: 's', APP_SECRET_ID: '' })
    expect(analyses.APP_SECRET_ID).toBeUndefined()
    const ingest = getIngestEnv({ CLICKHOUSE_URL: 'http://localhost:8123', CLICKHOUSE_USER: 'u', CLICKHOUSE_PASSWORD: 'p', CLICKHOUSE_DATABASE: 'leadex_dev', STAGE: 'dev', BOUNCER_API_KEY: '', INGEST_PROFILE_MAX_PER_RUN: '' })
    expect(ingest.BOUNCER_API_KEY).toBeUndefined()
    expect(ingest.INGEST_PROFILE_MAX_PER_RUN).toBe(0)
    expect(() => getAnalysesEnv({ TABLE_RATE_LIMITS: '', TURNSTILE_VERIFY_URL: 'https://verify.example', TURNSTILE_SECRET: 's' })).toThrow(/TABLE_RATE_LIMITS/)
  })
})
