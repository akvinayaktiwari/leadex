import { GetCommand, PutCommand, UpdateCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { runRecordSchema } from '../lib/schemas.js'
import type { RunErrorInfo, RunRecord, RunStatus, RunsRepository } from '../types/index.js'

function parseRun(item: Record<string, unknown>): RunRecord {
  const result = runRecordSchema.safeParse(item)
  if (!result.success) throw new Error(`Stored run is malformed: ${result.error.message}`)
  return result.data
}

function statusUpdate(status: RunStatus, updatedAt: string, error?: RunErrorInfo): {
  UpdateExpression: string
  ExpressionAttributeValues: Record<string, unknown>
} {
  const values: Record<string, unknown> = { ':status': status, ':updatedAt': updatedAt }
  if (!error) return { UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt REMOVE #error', ExpressionAttributeValues: values }
  values[':error'] = error
  return { UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt, #error = :error', ExpressionAttributeValues: values }
}

export function createRunsTableRepository(client: DynamoDBDocumentClient, tableName: string): RunsRepository {
  return {
    async create(run: RunRecord): Promise<void> {
      await client.send(
        new PutCommand({ TableName: tableName, Item: run, ConditionExpression: 'attribute_not_exists(runId)' }),
      )
    },
    async get(runId: string): Promise<RunRecord | undefined> {
      const result = await client.send(new GetCommand({ TableName: tableName, Key: { runId }, ConsistentRead: true }))
      return result.Item ? parseRun(result.Item) : undefined
    },
    async setStatus(runId: string, status: RunStatus, updatedAt: string, error?: RunErrorInfo): Promise<void> {
      await client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { runId },
          ConditionExpression: 'attribute_exists(runId)',
          ExpressionAttributeNames: { '#status': 'status', '#error': 'error' },
          ...statusUpdate(status, updatedAt, error),
        }),
      )
    },
  }
}
