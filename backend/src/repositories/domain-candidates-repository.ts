import type { ClickHouseClient } from '@clickhouse/client'
import type { DomainCandidate, DomainCandidatesRepository } from '../types/index.js'

export function createDomainCandidatesRepository(client: ClickHouseClient): DomainCandidatesRepository {
  return {
    async insertCandidates(candidates: DomainCandidate[]): Promise<void> {
      if (candidates.length === 0) return
      await client.insert({
        table: 'domain_candidates',
        format: 'JSONEachRow',
        values: candidates.map((candidate) => ({
          domain: candidate.domain,
          tld: candidate.tld,
          harmonic_rank: candidate.harmonicRank,
          harmonic_value: candidate.harmonicValue,
          pagerank_rank: candidate.pagerankRank,
          hosts: candidate.hosts,
          release: candidate.release,
          imported_at: candidate.importedAt,
        })),
      })
    },
    async countForRelease(release: string): Promise<number> {
      const result = await client.query({
        query: 'SELECT count() AS n FROM domain_candidates FINAL WHERE release = {release:String}',
        query_params: { release },
        format: 'JSONEachRow',
      })
      const [row] = await result.json<{ n: string | number }>()
      return Number(row?.n ?? 0)
    },
  }
}
