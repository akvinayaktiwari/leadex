// Applies infra/clickhouse/*.sql to the database in CLICKHOUSE_DATABASE.
// Usage: npm run migrate:clickhouse --workspace backend (reads CLICKHOUSE_* from the environment).
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClickhouseClient } from '../src/lib/clickhouse-client.js'
import { systemClock } from '../src/lib/clock.js'
import { getLeadDataEnv } from '../src/lib/env.js'
import { createLeadDataSchemaRepository } from '../src/repositories/lead-data-schema-repository.js'
import { migrateLeadData } from '../src/services/lead-data-migration-service.js'
import type { LeadDataEnv, MigrationFile } from '../src/types/index.js'

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../infra/clickhouse/', import.meta.url))

export function readMigrationFiles(dir: string = MIGRATIONS_DIR): MigrationFile[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }))
}

export async function runMigrations(env: LeadDataEnv): Promise<string[]> {
  const client = createClickhouseClient(env)
  const admin = createClickhouseClient(env, { withDatabase: false })
  try {
    const schema = createLeadDataSchemaRepository(client, admin, env.CLICKHOUSE_DATABASE)
    return await migrateLeadData(schema, readMigrationFiles(), systemClock)
  } finally {
    await Promise.all([client.close(), admin.close()])
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const applied = await runMigrations(getLeadDataEnv())
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Already up to date')
}
