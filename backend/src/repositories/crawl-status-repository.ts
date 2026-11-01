import type { ClickHouseClient } from '@clickhouse/client'
import type { CrawlStatusEntry, CrawlStatusRepository, ProfileCandidate, ProfileSelection } from '../types/index.js'

// Best-linked domains first that were never processed, failed fewer than maxAttempts times and not recently,
// or were profiled/skipped long enough ago to refresh. A missing status row reads as status '' (no join nulls).
const NEXT_TO_PROFILE_SQL = `
  SELECT c.domain AS domain, c.harmonic_rank AS harmonic_rank, s.attempts AS attempts
  FROM (SELECT domain, harmonic_rank FROM domain_candidates FINAL) AS c
  LEFT JOIN (SELECT domain, status, attempts, checked_at FROM domain_crawl_status FINAL) AS s ON s.domain = c.domain
  WHERE c.domain NOT IN {excluded:Array(String)}
    AND (
      s.status = ''
      OR (s.status = 'failed' AND s.attempts < {maxAttempts:UInt16} AND s.checked_at < {retryBefore:DateTime('UTC')})
      OR (s.status IN ('profiled', 'skipped') AND s.checked_at < {refreshBefore:DateTime('UTC')})
    )
  ORDER BY c.harmonic_rank, c.domain
  LIMIT {limit:UInt32}`

// "2026-11-01T10:00:00.000Z" → "2026-11-01 10:00:00" (query parameters are not parsed best-effort).
function toClickhouseTime(iso: string): string {
  return new Date(iso).toISOString().replace('T', ' ').slice(0, 19)
}

export function createCrawlStatusRepository(client: ClickHouseClient): CrawlStatusRepository {
  return {
    async nextToProfile(selection: ProfileSelection): Promise<ProfileCandidate[]> {
      const result = await client.query({
        query: NEXT_TO_PROFILE_SQL,
        format: 'JSONEachRow',
        query_params: {
          excluded: selection.excludedDomains, maxAttempts: selection.maxAttempts, limit: selection.limit,
          retryBefore: toClickhouseTime(selection.retryFailedBefore), refreshBefore: toClickhouseTime(selection.refreshProfiledBefore),
        },
      })
      const rows = await result.json<{ domain: string; harmonic_rank: number; attempts: number }>()
      return rows.map((row) => ({ domain: row.domain, harmonicRank: Number(row.harmonic_rank), attempts: Number(row.attempts) }))
    },
    async recordStatus(entries: CrawlStatusEntry[]): Promise<void> {
      if (entries.length === 0) return
      await client.insert({
        table: 'domain_crawl_status',
        format: 'JSONEachRow',
        values: entries.map((entry) => ({ domain: entry.domain, status: entry.status, reason: entry.reason, attempts: entry.attempts, checked_at: entry.checkedAt })),
      })
    },
  }
}
