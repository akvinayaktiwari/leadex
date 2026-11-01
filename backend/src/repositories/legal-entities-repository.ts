import type { ClickHouseClient } from '@clickhouse/client'
import type { GleifImportKind, GleifImportRecord, GleifRecord, LegalEntitiesRepository, LegalEntityNameRow } from '../types/index.js'

// ClickHouse returns DateTime('UTC') as "YYYY-MM-DD hh:mm:ss".
const toIso = (value: string): string => new Date(`${value.replace(' ', 'T')}Z`).toISOString()
const toClickhouseTime = (iso: string): string => new Date(iso).toISOString().replace('T', ' ').slice(0, 19)

interface NameRow {
  name_key: string
  lei: string
  legal_country: string
  hq_country: string
  entity_status: string
  registration_status: string
  publish_date: string
}

async function insert(client: ClickHouseClient, table: string, values: object[]): Promise<void> {
  if (values.length > 0) await client.insert({ table, values, format: 'JSONEachRow' })
}

function importMethods(client: ClickHouseClient): Pick<LegalEntitiesRepository, 'latestImport' | 'hasImport' | 'recordImport'> {
  return {
    async latestImport(kind: GleifImportKind): Promise<GleifImportRecord | undefined> {
      const result = await client.query({
        query: 'SELECT kind, publish_date, records, imported_at FROM gleif_imports FINAL WHERE kind = {kind:String} ORDER BY publish_date DESC LIMIT 1',
        query_params: { kind }, format: 'JSONEachRow',
      })
      const [row] = await result.json<{ kind: GleifImportKind; publish_date: string; records: number; imported_at: string }>()
      return row ? { kind: row.kind, publishDate: toIso(row.publish_date), records: Number(row.records), importedAt: toIso(row.imported_at) } : undefined
    },
    async hasImport(kind: GleifImportKind, publishDate: string): Promise<boolean> {
      const result = await client.query({
        query: 'SELECT count() AS n FROM gleif_imports FINAL WHERE kind = {kind:String} AND publish_date = {date:DateTime(\'UTC\')}',
        query_params: { kind, date: toClickhouseTime(publishDate) }, format: 'JSONEachRow',
      })
      const [row] = await result.json<{ n: string | number }>()
      return Number(row?.n ?? 0) > 0
    },
    async recordImport(record: GleifImportRecord): Promise<void> {
      await insert(client, 'gleif_imports', [{ kind: record.kind, publish_date: record.publishDate, records: record.records, imported_at: record.importedAt }])
    },
  }
}

export function createLegalEntitiesRepository(client: ClickHouseClient): LegalEntitiesRepository {
  return {
    insertEntities: (records, publishDate) => insert(client, 'legal_entities', records.map((record) => ({
      lei: record.lei, legal_name: record.legalName, legal_country: record.legalCountry, legal_city: record.legalCity,
      hq_country: record.hqCountry, hq_city: record.hqCity, jurisdiction: record.jurisdiction, category: record.category,
      legal_form: record.legalForm, entity_status: record.entityStatus, registration_status: record.registrationStatus, publish_date: publishDate,
    }))),
    insertNames: (rows) => insert(client, 'legal_entity_names', rows.map((row) => ({
      name_key: row.nameKey, lei: row.lei, legal_country: row.legalCountry, hq_country: row.hqCountry,
      entity_status: row.entityStatus, registration_status: row.registrationStatus, publish_date: row.publishDate,
    }))),
    ...importMethods(client),
    async findNames(nameKeys: string[]): Promise<LegalEntityNameRow[]> {
      if (nameKeys.length === 0) return []
      const result = await client.query({
        query: 'SELECT name_key, lei, legal_country, hq_country, entity_status, registration_status, publish_date FROM legal_entity_names FINAL WHERE name_key IN {keys:Array(String)} ORDER BY name_key, lei',
        query_params: { keys: nameKeys }, format: 'JSONEachRow',
      })
      const rows = await result.json<NameRow>()
      return rows.map((row) => ({
        nameKey: row.name_key, lei: row.lei, legalCountry: row.legal_country, hqCountry: row.hq_country,
        entityStatus: row.entity_status, registrationStatus: row.registration_status, publishDate: toIso(row.publish_date),
      }))
    },
  }
}
