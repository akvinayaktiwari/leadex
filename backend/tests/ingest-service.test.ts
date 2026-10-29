import { describe, expect, it } from 'vitest'
import { getIngestEnv } from '../src/lib/env.js'
import { ingestExitCode, runIngestion } from '../src/services/ingest-service.js'
import type { IngestJob } from '../src/types/index.js'
import { manualClock } from './support/in-memory-run-store.js'

const BASE_ENV = {
  STAGE: 'dev', CLICKHOUSE_URL: 'http://localhost:8123', CLICKHOUSE_USER: 'u', CLICKHOUSE_PASSWORD: 'p', CLICKHOUSE_DATABASE: 'leadex_dev',
}

function job(name: string, run: IngestJob['run']): IngestJob & { calls: number } {
  const tracked = { name, calls: 0, run: async () => { tracked.calls += 1; return run() } }
  return tracked
}

describe('ingest', () => {
  // protects=imports never start unless INGEST_ENABLED is exactly "true" (missing, empty-ish or other values mean off);
  // fails_when=an unset variable or "TRUE"/"1" turns imports on, or "true" leaves them off;
  // no_claim=does not test the EventBridge schedule (CDK test covers that it is disabled by default).
  it('reads INGEST_ENABLED as off unless "true"', () => {
    expect(getIngestEnv(BASE_ENV).INGEST_ENABLED).toBe(false)
    expect(getIngestEnv({ ...BASE_ENV, INGEST_ENABLED: 'false' }).INGEST_ENABLED).toBe(false)
    expect(getIngestEnv({ ...BASE_ENV, INGEST_ENABLED: 'true' }).INGEST_ENABLED).toBe(true)
    expect(() => getIngestEnv({ ...BASE_ENV, INGEST_ENABLED: 'TRUE' })).toThrow(/INGEST_ENABLED/)
    expect(() => getIngestEnv({ ...BASE_ENV, CLICKHOUSE_DATABASE: 'leadex-dev; DROP' })).toThrow(/CLICKHOUSE_DATABASE/)
  })

  // protects=a disabled run touches no source at all;
  // fails_when=jobs run while INGEST_ENABLED is false;
  // no_claim=n/a.
  it('runs nothing when disabled', async () => {
    const source = job('gleif', async () => ({ written: 1, skipped: 0 }))
    const summary = await runIngestion(false, [source], manualClock())
    expect(summary).toEqual({ enabled: false, outcomes: [] })
    expect(source.calls).toBe(0)
    expect(ingestExitCode(summary)).toBe(0)
  })

  // protects=one failing source is reported but does not stop the next, and the task exits non-zero so the failure is visible;
  // fails_when=an exception aborts the loop, is swallowed as success, or the exit code stays 0;
  // no_claim=does not retry failed jobs (the next scheduled run does).
  it('isolates failures and reports them', async () => {
    const failing = job('sec_edgar', async () => { throw new Error('rate limited') })
    const ok = job('gleif', async () => ({ written: 5, skipped: 2 }))
    const summary = await runIngestion(true, [failing, ok], manualClock())
    expect(ok.calls).toBe(1)
    expect(summary.outcomes).toMatchObject([
      { name: 'sec_edgar', ok: false, error: 'rate limited' },
      { name: 'gleif', ok: true, result: { written: 5, skipped: 2 } },
    ])
    expect(ingestExitCode(summary)).toBe(1)
  })
})
