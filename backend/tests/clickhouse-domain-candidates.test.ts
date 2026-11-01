import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClickhouseClient } from '../src/lib/clickhouse-client.js'
import { parseDomainRankLine } from '../src/repositories/common-crawl-repository.js'
import { createDomainCandidatesRepository } from '../src/repositories/domain-candidates-repository.js'
import { importDomainRanks } from '../src/services/domain-import-service.js'
import type { DomainRankLine, DomainRanksSource, LeadDataEnv } from '../src/types/index.js'
import { runMigrations } from '../tools/clickhouse-migrate.js'
import { manualClock } from './support/in-memory-run-store.js'

// Same local setup as clickhouse-lead-data.test.ts; skipped without CLICKHOUSE_URL (required in CI there).
const URL_ = process.env.CLICKHOUSE_URL
const ENV: LeadDataEnv = {
  CLICKHOUSE_URL: URL_ ?? 'http://localhost:8123',
  CLICKHOUSE_USER: process.env.CLICKHOUSE_USER ?? 'leadex',
  CLICKHOUSE_PASSWORD: process.env.CLICKHOUSE_PASSWORD ?? 'leadex',
  CLICKHOUSE_DATABASE: `leadex_test_domains_${Date.now()}`,
}
const RANKS_URL = 'https://data.commoncrawl.org/projects/hyperlinkgraph/cc-main-2026-apr-may-jun/domain/ranks.txt.gz'

function source(reversed: string[]): DomainRanksSource {
  const lines: DomainRankLine[] = reversed.map((domain, i) => parseDomainRankLine(`${i + 1}\t${100 - i}\t${i + 1}\t0.1\t${domain}\t1`)!)
  return { async *streamDomainRanks() { yield* lines } }
}

describe.runIf(URL_)('domain candidates on ClickHouse', () => {
  const client = createClickhouseClient(ENV)
  const admin = createClickhouseClient(ENV, { withDatabase: false })
  const candidates = createDomainCandidatesRepository(client)

  beforeAll(async () => {
    expect(await runMigrations(ENV)).toEqual(['001_leadex_data.sql', '002_domain_candidates.sql', '003_legal_entities.sql', '004_people_extraction.sql'])
  })

  afterAll(async () => {
    await admin.command({ query: `DROP DATABASE IF EXISTS ${ENV.CLICKHOUSE_DATABASE}` })
    await Promise.all([client.close(), admin.close()])
  })

  // protects=an import writes rows the per-release count sees, a re-import replaces rather than duplicates them,
  // and a full release is then skipped;
  // fails_when=a redone partial import doubles the count, or the daily job re-imports a complete release;
  // no_claim=does not download from data.commoncrawl.org.
  it('imports, re-imports without duplicates, then skips a complete release', async () => {
    const deps = { candidates, clock: manualClock('2026-11-01T00:00:00.000Z') }
    const options = { url: RANKS_URL, maxDomains: 3, batchSize: 2 }
    expect(await importDomainRanks({ ...deps, source: source(['com.a', 'de.b', 'com.c']) }, options)).toEqual({ written: 2, skipped: 1 })
    expect(await candidates.countForRelease('cc-main-2026-apr-may-jun')).toBe(2)
    const second = { ...deps, clock: manualClock('2026-11-02T00:00:00.000Z') }
    expect(await importDomainRanks({ ...second, source: source(['com.a', 'com.c', 'com.d']) }, options)).toEqual({ written: 3, skipped: 0 })
    expect(await candidates.countForRelease('cc-main-2026-apr-may-jun')).toBe(3)
    expect(await importDomainRanks({ ...second, source: source(['com.e']) }, options)).toEqual({ written: 0, skipped: 0 })
    const rows = await (await client.query({ query: 'SELECT domain, harmonic_rank FROM domain_candidates FINAL ORDER BY domain', format: 'JSONEachRow' })).json<{ domain: string; harmonic_rank: number }>()
    expect(rows).toEqual([{ domain: 'a.com', harmonic_rank: 1 }, { domain: 'c.com', harmonic_rank: 2 }, { domain: 'd.com', harmonic_rank: 3 }])
  })
})
