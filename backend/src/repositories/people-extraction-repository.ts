import type { ClickHouseClient } from '@clickhouse/client'
import type { PeopleCandidate, PeopleExtractionRepository, PeopleSelection, PeopleStatusEntry, PublishedEmailRow } from '../types/index.js'
import { COMPANY_COLUMNS, fromCompanyRow, type CompanyRow } from './lead-data-repository.js'

const toClickhouseTime = (iso: string): string => new Date(iso).toISOString().replace('T', ' ').slice(0, 19)
const toIso = (value: string): string => new Date(`${value.replace(' ', 'T')}Z`).toISOString()

// Most recently profiled companies first. A missing status row reads as status '' (no join nulls).
const NEXT_COMPANIES_SQL = `
  SELECT ${COMPANY_COLUMNS.split(', ').map((column) => `c.${column} AS ${column}`).join(', ')}, s.attempts AS attempts
  FROM (SELECT ${COMPANY_COLUMNS} FROM companies FINAL) AS c
  LEFT JOIN (SELECT domain, status, attempts, checked_at FROM people_extraction_status FINAL) AS s ON s.domain = c.domain
  WHERE c.country NOT IN {excluded:Array(String)}
    AND (
      s.status = ''
      OR (s.status = 'failed' AND s.attempts < {maxAttempts:UInt16} AND s.checked_at < {retryBefore:DateTime('UTC')})
      OR (s.status IN ('done', 'skipped') AND s.checked_at < {refreshBefore:DateTime('UTC')})
    )
  ORDER BY c.updated_at DESC, c.domain
  LIMIT {limit:UInt32}`

interface EmailRow {
  domain: string
  email: string
  kind: PublishedEmailRow['kind']
  person_key: string
  source_url: string
  seen_at: string
}

export function createPeopleExtractionRepository(client: ClickHouseClient): PeopleExtractionRepository {
  return {
    async nextCompanies(selection: PeopleSelection): Promise<PeopleCandidate[]> {
      const result = await client.query({
        query: NEXT_COMPANIES_SQL, format: 'JSONEachRow',
        query_params: {
          excluded: selection.excludedCountries, maxAttempts: selection.maxAttempts, limit: selection.limit,
          retryBefore: toClickhouseTime(selection.retryFailedBefore), refreshBefore: toClickhouseTime(selection.refreshBefore),
        },
      })
      const rows = await result.json<CompanyRow & { attempts: number }>()
      return rows.map((row) => ({ company: fromCompanyRow(row), attempts: Number(row.attempts) }))
    },
    async recordStatus(entries: PeopleStatusEntry[]): Promise<void> {
      if (entries.length === 0) return
      await client.insert({ table: 'people_extraction_status', format: 'JSONEachRow', values: entries.map((entry) => ({
        domain: entry.domain, status: entry.status, reason: entry.reason, people_found: entry.peopleFound, attempts: entry.attempts, checked_at: entry.checkedAt,
      })) })
    },
    async insertPublishedEmails(rows: PublishedEmailRow[]): Promise<void> {
      if (rows.length === 0) return
      await client.insert({ table: 'published_emails', format: 'JSONEachRow', values: rows.map((row) => ({
        domain: row.domain, email: row.email, kind: row.kind, person_key: row.personKey, source_url: row.sourceUrl, seen_at: row.seenAt,
      })) })
    },
    async listPublishedEmails(domain: string): Promise<PublishedEmailRow[]> {
      const result = await client.query({
        query: 'SELECT domain, email, kind, person_key, source_url, seen_at FROM published_emails FINAL WHERE domain = {domain:String} ORDER BY email',
        query_params: { domain }, format: 'JSONEachRow',
      })
      const rows = await result.json<EmailRow>()
      return rows.map((row) => ({ domain: row.domain, email: row.email, kind: row.kind, personKey: row.person_key, sourceUrl: row.source_url, seenAt: toIso(row.seen_at) }))
    },
  }
}
