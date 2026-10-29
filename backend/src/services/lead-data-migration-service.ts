import type { Clock, LeadDataSchemaRepository, MigrationFile } from '../types/index.js'

// Splits a migration file into statements: drops `--` comments, splits on `;`, ignores blanks.
// Migrations must not contain `;` inside string literals.
export function splitStatements(sql: string): string[] {
  const withoutComments = sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
  return withoutComments
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
}

// Applies pending migrations in name order and returns the names it applied.
export async function migrateLeadData(
  schema: LeadDataSchemaRepository,
  files: MigrationFile[],
  clock: Clock,
): Promise<string[]> {
  await schema.ensureDatabase()
  const applied = await schema.appliedMigrations()
  const pending = [...files].sort((a, b) => a.name.localeCompare(b.name)).filter((file) => !applied.has(file.name))
  for (const file of pending) {
    await schema.applyMigration(file.name, splitStatements(file.sql), clock.now().toISOString())
  }
  return pending.map((file) => file.name)
}
