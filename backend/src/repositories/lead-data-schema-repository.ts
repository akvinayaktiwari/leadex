import type { ClickHouseClient } from '@clickhouse/client'
import type { LeadDataSchemaRepository } from '../types/index.js'

const MIGRATIONS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  name String,
  applied_at DateTime('UTC')
) ENGINE = ReplacingMergeTree(applied_at) ORDER BY name`

// `admin` has no default database, so it can create the one `client` points at.
export function createLeadDataSchemaRepository(
  client: ClickHouseClient,
  admin: ClickHouseClient,
  database: string,
): LeadDataSchemaRepository {
  // The name is interpolated into DDL, so it must be a plain identifier (env.ts enforces the same rule).
  if (!/^[a-z][a-z0-9_]*$/.test(database)) throw new Error(`Invalid ClickHouse database name: ${database}`)
  return {
    async ensureDatabase(): Promise<void> {
      await admin.command({ query: `CREATE DATABASE IF NOT EXISTS ${database}` })
      await client.command({ query: MIGRATIONS_TABLE_SQL })
    },
    async appliedMigrations(): Promise<Set<string>> {
      const result = await client.query({ query: 'SELECT DISTINCT name FROM schema_migrations FINAL', format: 'JSONEachRow' })
      const rows = await result.json<{ name: string }>()
      return new Set(rows.map((row) => row.name))
    },
    async applyMigration(name: string, statements: string[], appliedAt: string): Promise<void> {
      for (const statement of statements) await client.command({ query: statement })
      await client.insert({ table: 'schema_migrations', values: [{ name, applied_at: appliedAt }], format: 'JSONEachRow' })
    },
  }
}
