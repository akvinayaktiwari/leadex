import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClickhouseClient } from '../src/lib/clickhouse-client.js'
import { createLegalEntitiesRepository } from '../src/repositories/legal-entities-repository.js'
import { importGleif, isImportable, nameRows } from '../src/services/gleif-import-service.js'
import type { GleifImportKind, GleifImportRecord, GleifPublish, GleifRecord, GleifSource, LeadDataEnv, LegalEntitiesRepository, LegalEntityNameRow } from '../src/types/index.js'
import { runMigrations } from '../tools/clickhouse-migrate.js'
import { manualClock } from './support/in-memory-run-store.js'

const PUBLISH: GleifPublish = { publishDate: '2026-11-01T08:00:00.000Z', fullCsvUrl: 'full', fullRecords: 3, lastDayCsvUrl: 'day' }
const OPTIONS = { fullEveryDays: 30, batchSize: 2 }

function record(lei: string, overrides: Partial<GleifRecord> = {}): GleifRecord {
  return {
    lei, legalName: `${lei} PRIVATE LIMITED`, otherNames: [], legalCountry: 'IN', legalCity: 'PUNE', hqCountry: 'IN', hqCity: 'PUNE',
    jurisdiction: 'IN', category: 'GENERAL', legalForm: 'XXXX', entityStatus: 'ACTIVE', registrationStatus: 'ISSUED', ...overrides,
  }
}

function source(files: Record<string, GleifRecord[]>, failAfter?: number): GleifSource & { opened: string[] } {
  const opened: string[] = []
  return {
    opened,
    async latestPublish() { return PUBLISH },
    async *streamRecords(url: string) {
      opened.push(url)
      let n = 0
      for (const item of files[url] ?? []) {
        if (failAfter !== undefined && n++ >= failAfter) throw new Error('connection reset')
        yield item
      }
    },
  }
}

function memoryEntities(imports: GleifImportRecord[] = []): LegalEntitiesRepository & { entities: GleifRecord[]; names: LegalEntityNameRow[]; imports: GleifImportRecord[] } {
  const state = { entities: [] as GleifRecord[], names: [] as LegalEntityNameRow[], imports }
  return {
    ...state,
    async insertEntities(rows: GleifRecord[]) { state.entities.push(...rows) },
    async insertNames(rows: LegalEntityNameRow[]) { state.names.push(...rows) },
    async latestImport(kind: GleifImportKind) { return [...state.imports].filter((i) => i.kind === kind).sort((a, b) => b.publishDate.localeCompare(a.publishDate))[0] },
    async hasImport(kind: GleifImportKind, date: string) { return state.imports.some((i) => i.kind === kind && i.publishDate === date) },
    async recordImport(entry: GleifImportRecord) { state.imports.push(entry) },
    async findNames(keys: string[]) { return state.names.filter((row) => keys.includes(row.nameKey)) },
  }
}

const full = (date: string): GleifImportRecord => ({ kind: 'full', publishDate: date, records: 1, importedAt: date })

describe('gleif import rules', () => {
  // protects=EU/EEA/UK-only entities are not imported, but an entity with an allowed legal or head-office country is;
  // fails_when=a German GmbH is stored, or an Indian subsidiary with a UK head office is dropped;
  // no_claim=n/a.
  it('imports entities with any allowed country', () => {
    expect(isImportable(record('A', { legalCountry: 'DE', hqCountry: 'DE' }))).toBe(false)
    expect(isImportable(record('B', { legalCountry: 'IN', hqCountry: 'GB' }))).toBe(true)
    expect(isImportable(record('C', { legalName: '' }))).toBe(false)
  })

  // protects=one name row per distinct name key (legal + other names), so lookups by any spelling find the LEI once;
  // fails_when=an other name equal to the legal name after normalization produces a duplicate row;
  // no_claim=n/a.
  it('builds deduplicated name rows', () => {
    const rows = nameRows(record('A', { legalName: 'Acme Pvt Ltd', otherNames: ['ACME PRIVATE LIMITED', 'Acme Software'] }), PUBLISH.publishDate)
    expect(rows.map((row) => row.nameKey)).toEqual(['acme', 'acme software'])
  })
})

describe('gleif import service', () => {
  // protects=with no full import, the full file is streamed, EU-only rows skipped, and the import recorded after the rows;
  // fails_when=the delta is applied first, a skipped row is written, or the import is recorded before the rows are in;
  // no_claim=memory repository (ClickHouse round-trip below).
  it('imports the full file first', async () => {
    const entities = memoryEntities()
    const files = { full: [record('A'), record('B', { legalCountry: 'FR', hqCountry: 'FR' }), record('C'), record('D')] }
    const result = await importGleif({ source: source(files), entities, clock: manualClock('2026-11-01T09:00:00.000Z') }, OPTIONS)
    expect(result).toEqual({ written: 3, skipped: 1 })
    expect(entities.entities.map((e) => e.lei)).toEqual(['A', 'C', 'D'])
    expect(entities.imports).toMatchObject([{ kind: 'full', publishDate: PUBLISH.publishDate, records: 3 }])
  })

  // protects=after a recent full import only the last-day delta is applied, once per publish date, and a full file is due
  // again after fullEveryDays;
  // fails_when=the 484 MB file is downloaded every day, a delta is applied twice, or the full file never refreshes;
  // no_claim=a missed day's delta is not back-filled; the next full file covers it.
  it('applies deltas between full files', async () => {
    const clock = manualClock('2026-11-01T09:00:00.000Z')
    const recent = memoryEntities([full('2026-10-20T08:00:00.000Z')])
    const deltaSource = source({ day: [record('E')] })
    expect(await importGleif({ source: deltaSource, entities: recent, clock }, OPTIONS)).toEqual({ written: 1, skipped: 0 })
    expect(deltaSource.opened).toEqual(['day'])
    expect(await importGleif({ source: deltaSource, entities: recent, clock }, OPTIONS)).toEqual({ written: 0, skipped: 0 })
    expect(deltaSource.opened).toEqual(['day'])
    const sameDay = memoryEntities([full(PUBLISH.publishDate)])
    expect(await importGleif({ source: source({}), entities: sameDay, clock }, OPTIONS)).toEqual({ written: 0, skipped: 0 })
    const stale = source({ full: [record('F')] })
    await importGleif({ source: stale, entities: memoryEntities([full('2026-09-20T08:00:00.000Z')]), clock }, OPTIONS)
    expect(stale.opened).toEqual(['full'])
  })

  // protects=a download that breaks mid-file fails the job and is not recorded, so the next run redoes it;
  // fails_when=a partial import is recorded as done and never completed;
  // no_claim=rows written before the failure stay (replaced, not duplicated, on the redo).
  it('does not record an interrupted import', async () => {
    const entities = memoryEntities()
    const broken = source({ full: [record('A'), record('B'), record('C')] }, 2)
    await expect(importGleif({ source: broken, entities, clock: manualClock() }, OPTIONS)).rejects.toThrow(/connection reset/)
    expect(entities.imports).toEqual([])
  })
})

const URL_ = process.env.CLICKHOUSE_URL
const ENV: LeadDataEnv = {
  CLICKHOUSE_URL: URL_ ?? 'http://localhost:8123', CLICKHOUSE_USER: process.env.CLICKHOUSE_USER ?? 'leadex',
  CLICKHOUSE_PASSWORD: process.env.CLICKHOUSE_PASSWORD ?? 'leadex', CLICKHOUSE_DATABASE: `leadex_test_gleif_${Date.now()}`,
}

describe.runIf(URL_)('legal entities on ClickHouse', () => {
  const client = createClickhouseClient(ENV)
  const admin = createClickhouseClient(ENV, { withDatabase: false })
  const repository = createLegalEntitiesRepository(client)

  beforeAll(async () => {
    await runMigrations(ENV)
  })

  afterAll(async () => {
    await admin.command({ query: `DROP DATABASE IF EXISTS ${ENV.CLICKHOUSE_DATABASE}` })
    await Promise.all([client.close(), admin.close()])
  })

  // protects=an import and a later re-import round-trip through ClickHouse: names are found by key, the newer publish wins,
  // and import records answer latest/has questions with exact dates;
  // fails_when=a redone import duplicates name rows, an older status shadows the newer, or the date comparison misses;
  // no_claim=n/a.
  it('stores entities, names and imports', async () => {
    const deps = { entities: repository, clock: manualClock('2026-11-01T09:00:00.000Z') }
    await importGleif({ ...deps, source: source({ full: [record('L1', { legalName: 'Acme Pvt Ltd', otherNames: ['Acme Software'], registrationStatus: 'LAPSED' })] }) }, OPTIONS)
    await repository.insertNames(nameRows(record('L1', { legalName: 'Acme Pvt Ltd', registrationStatus: 'ISSUED' }), '2026-11-02T08:00:00.000Z'))
    const names = await repository.findNames(['acme', 'acme software', 'nobody'])
    expect(names.map((row) => `${row.nameKey}:${row.lei}:${row.registrationStatus}`)).toEqual(['acme:L1:ISSUED', 'acme software:L1:LAPSED'])
    expect(await repository.latestImport('full')).toMatchObject({ kind: 'full', publishDate: PUBLISH.publishDate, records: 1 })
    expect(await repository.hasImport('full', PUBLISH.publishDate)).toBe(true)
    expect(await repository.hasImport('delta', PUBLISH.publishDate)).toBe(false)
  })
})
