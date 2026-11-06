// The app's DynamoDB tables for the local stack. Must match TABLE_SPECS in infra/lib/leadex-stack.ts (an infra test
// compares them). Local tables are named leadex-local-<id>.
export interface LocalTable {
  envName: string
  id: string
  partitionKey: string
  sortKey?: { name: string; type: 'S' | 'N' }
}

export const LOCAL_TABLES: LocalTable[] = [
  { envName: 'TABLE_USERS', id: 'users', partitionKey: 'userId' },
  { envName: 'TABLE_ANALYSES', id: 'analyses', partitionKey: 'domain', sortKey: { name: 'pipelineVersion', type: 'S' } },
  { envName: 'TABLE_RUNS', id: 'runs', partitionKey: 'runId' },
  { envName: 'TABLE_RUN_EVENTS', id: 'run_events', partitionKey: 'runId', sortKey: { name: 'seq', type: 'N' } },
  { envName: 'TABLE_LEADS', id: 'leads', partitionKey: 'userId', sortKey: { name: 'leadId', type: 'S' } },
  { envName: 'TABLE_CREDIT_LEDGER', id: 'credit_ledger', partitionKey: 'userId', sortKey: { name: 'entryKey', type: 'S' } },
  { envName: 'TABLE_INTEGRATIONS', id: 'integrations', partitionKey: 'userId', sortKey: { name: 'provider', type: 'S' } },
  { envName: 'TABLE_RATE_LIMITS', id: 'rate_limits', partitionKey: 'key' },
]

export const localTableName = (id: string): string => `leadex-local-${id}`
