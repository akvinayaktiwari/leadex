// Prepares the local stack from docker-compose.yml: DynamoDB tables, the runs queue and the ClickHouse schema.
// Usage: docker compose up -d && npm run local:setup --workspace backend (reads backend/.env). Safe to run again.
import { getLeadDataEnv } from '../src/lib/env.js'
import { createLocalStackRepository } from '../src/repositories/local-stack-repository.js'
import { runMigrations } from './clickhouse-migrate.js'
import { LOCAL_TABLES, localTableName } from './local-tables.js'

const QUEUE_NAME = 'leadex-local-runs'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set; copy backend/.env.example to backend/.env`)
  return value
}

const repository = createLocalStackRepository(required('AWS_REGION'), required('DYNAMODB_ENDPOINT'), required('SQS_ENDPOINT'))
const created = await repository.ensureTables(LOCAL_TABLES.map((table) => ({ name: localTableName(table.id), partitionKey: table.partitionKey, sortKey: table.sortKey })))
console.log(created.length ? `DynamoDB tables created: ${created.join(', ')}` : 'DynamoDB tables already exist')
console.log(`Queue ready: ${await repository.ensureQueue(QUEUE_NAME)}`)
const applied = await runMigrations(getLeadDataEnv())
console.log(applied.length ? `ClickHouse migrations applied: ${applied.join(', ')}` : 'ClickHouse schema up to date')
