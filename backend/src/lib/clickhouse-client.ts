import { createClient, type ClickHouseClient } from '@clickhouse/client'
import type { LeadDataEnv } from '../types/index.js'

// `withDatabase: false` gives a client with no default database (used to create it).
export function createClickhouseClient(env: LeadDataEnv, options: { withDatabase: boolean } = { withDatabase: true }): ClickHouseClient {
  return createClient({
    url: env.CLICKHOUSE_URL,
    username: env.CLICKHOUSE_USER,
    password: env.CLICKHOUSE_PASSWORD,
    ...(options.withDatabase ? { database: env.CLICKHOUSE_DATABASE } : {}),
    // Rows are written as ISO-8601 strings; let the server parse them.
    clickhouse_settings: { date_time_input_format: 'best_effort' },
  })
}
