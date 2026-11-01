import type { ClickHouseClient } from '@clickhouse/client'
import type {
  DomainPatternRow, EmailCheck, EmailEvidenceRow, EmailFinderRepository, EmailResult, EmailSelection, EmployeeBand, PersonNeedingEmail, PersonRecord,
} from '../types/index.js'
import { PERSON_COLUMNS, fromPersonRow, type PersonRow } from './lead-data-repository.js'

const toClickhouseTime = (iso: string): string => new Date(iso).toISOString().replace('T', ' ').slice(0, 19)

const prefixed = (alias: string): string => PERSON_COLUMNS.split(', ').map((column) => `${alias}.${column} AS ${column}`).join(', ')

// Senior people first, so a limited batch spends verifier credits on decision makers.
const NEXT_PEOPLE_SQL = `
  SELECT ${prefixed('p')}, c.employee_band AS employee_band
  FROM (SELECT ${PERSON_COLUMNS} FROM people FINAL) AS p
  LEFT JOIN (SELECT person_key, status, checked_at FROM emails FINAL) AS e ON e.person_key = p.person_key
  LEFT JOIN (SELECT domain, employee_band FROM companies FINAL) AS c ON c.domain = p.domain
  WHERE p.country NOT IN {excluded:Array(String)}
    AND (
      e.person_key = ''
      OR (e.status = 'unknown' AND e.checked_at < {retryBefore:DateTime('UTC')})
      OR (e.status IN ('valid', 'catch_all') AND e.checked_at < {recheckBefore:DateTime('UTC')})
    )
  ORDER BY multiIf(p.seniority = 'owner', 0, p.seniority = 'c_level', 1, p.seniority = 'vp', 2, p.seniority = 'director', 3, p.seniority = 'head', 4, p.seniority = 'manager', 5, 6),
    p.updated_at DESC, p.person_key
  LIMIT {limit:UInt32}`

// Verified addresses and published personal addresses, with the named person when known.
const EVIDENCE_SQL = `
  SELECT pe.domain AS domain, pe.email AS email, if(pe.person_key = '', 'published_unlinked', 'published_linked') AS strength,
    p.first_name AS first_name, p.last_name AS last_name
  FROM (SELECT domain, email, person_key FROM published_emails FINAL WHERE kind = 'personal' AND domain IN {domains:Array(String)}) AS pe
  LEFT JOIN (SELECT person_key, first_name, last_name FROM people FINAL) AS p ON p.person_key = pe.person_key
  UNION ALL
  SELECT p.domain AS domain, e.email AS email, 'verified' AS strength, p.first_name AS first_name, p.last_name AS last_name
  FROM (SELECT person_key, email FROM emails FINAL WHERE status = 'valid') AS e
  INNER JOIN (SELECT person_key, domain, first_name, last_name FROM people FINAL WHERE domain IN {domains:Array(String)}) AS p ON p.person_key = e.person_key`

async function select<T>(client: ClickHouseClient, query: string, params: Record<string, unknown>): Promise<T[]> {
  return (await client.query({ query, query_params: params, format: 'JSONEachRow' })).json<T>()
}

async function insert(client: ClickHouseClient, table: string, values: object[]): Promise<void> {
  if (values.length > 0) await client.insert({ table, values, format: 'JSONEachRow' })
}

function readMethods(client: ClickHouseClient): Pick<EmailFinderRepository, 'peopleNeedingEmail' | 'evidence' | 'colleagues' | 'invalidAddresses'> {
  return {
    async peopleNeedingEmail(selection: EmailSelection): Promise<PersonNeedingEmail[]> {
      const rows = await select<PersonRow & { employee_band: string }>(client, NEXT_PEOPLE_SQL, {
        excluded: selection.excludedCountries, limit: selection.limit,
        retryBefore: toClickhouseTime(selection.retryUnknownBefore), recheckBefore: toClickhouseTime(selection.recheckBefore),
      })
      return rows.map((row) => ({ person: fromPersonRow(row), employeeBand: (row.employee_band || undefined) as EmployeeBand | undefined }))
    },
    async evidence(domains: string[]): Promise<EmailEvidenceRow[]> {
      if (domains.length === 0) return []
      const rows = await select<{ domain: string; email: string; strength: EmailEvidenceRow['strength']; first_name: string; last_name: string }>(client, EVIDENCE_SQL, { domains })
      return rows.map((row) => ({ domain: row.domain, email: row.email, strength: row.strength, firstName: row.first_name, lastName: row.last_name }))
    },
    async colleagues(domains: string[]): Promise<PersonRecord[]> {
      if (domains.length === 0) return []
      return (await select<PersonRow>(client, `SELECT ${PERSON_COLUMNS} FROM people FINAL WHERE domain IN {domains:Array(String)}`, { domains })).map(fromPersonRow)
    },
    async invalidAddresses(domains: string[]): Promise<Set<string>> {
      if (domains.length === 0) return new Set()
      const rows = await select<{ email: string }>(client, "SELECT DISTINCT email FROM email_checks WHERE domain IN {domains:Array(String)} AND status = 'invalid'", { domains })
      return new Set(rows.map((row) => row.email))
    },
  }
}

export function createEmailFinderRepository(client: ClickHouseClient): EmailFinderRepository {
  return {
    ...readMethods(client),
    insertChecks: (checks: EmailCheck[]) => insert(client, 'email_checks', checks.map((check) => ({
      person_key: check.personKey, domain: check.domain, email: check.email, status: check.status, reason: check.reason, checked_by: check.checkedBy, checked_at: check.checkedAt,
    }))),
    insertResults: (results: EmailResult[]) => insert(client, 'emails', results.map((result) => ({
      person_key: result.personKey, email: result.email, pattern: result.pattern, status: result.status, checked_by: result.checkedBy, checked_at: result.checkedAt,
    }))),
    insertDomainPatterns: (rows: DomainPatternRow[]) => insert(client, 'domain_patterns', rows.map((row) => ({
      domain: row.domain, pattern: row.pattern, evidence_count: row.evidenceCount, mx_host: row.mxHost, accepts_all: row.acceptsAll ? 1 : 0, checked_at: row.checkedAt,
    }))),
  }
}
