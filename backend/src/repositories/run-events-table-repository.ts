import { PutCommand, QueryCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { runEventSchema } from '../lib/schemas.js'
import type { RunEvent, RunEventsRepository } from '../types/index.js'

// Matches the 7-day TTL on leadex_run_events in the spec.
const EVENT_TTL_SECONDS = 7 * 24 * 60 * 60

interface StoredRunEvent {
  runId: string
  seq: number
  // The whole event as JSON, so artifact payloads round-trip exactly (no DynamoDB type coercion).
  payload: string
  expiresAt: number
}

function toItem(runId: string, event: RunEvent): StoredRunEvent {
  const expiresAt = Math.floor(Date.parse(event.ts) / 1000) + EVENT_TTL_SECONDS
  return { runId, seq: event.seq, payload: JSON.stringify(event), expiresAt }
}

function fromItem(item: Record<string, unknown>): RunEvent {
  if (typeof item.payload !== 'string') throw new Error('Stored run event has no payload')
  const result = runEventSchema.safeParse(JSON.parse(item.payload))
  if (!result.success) throw new Error(`Stored run event is malformed: ${result.error.message}`)
  return result.data
}

export function createRunEventsTableRepository(client: DynamoDBDocumentClient, tableName: string): RunEventsRepository {
  return {
    async append(runId: string, event: RunEvent): Promise<void> {
      await client.send(
        new PutCommand({ TableName: tableName, Item: toItem(runId, event), ConditionExpression: 'attribute_not_exists(seq)' }),
      )
    },
    async listAfter(runId: string, afterSeq: number, limit: number): Promise<RunEvent[]> {
      const result = await client.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'runId = :runId AND seq > :afterSeq',
          ExpressionAttributeValues: { ':runId': runId, ':afterSeq': afterSeq },
          ConsistentRead: true,
          Limit: limit,
        }),
      )
      return (result.Items ?? []).map(fromItem)
    },
    async lastSeq(runId: string): Promise<number> {
      const result = await client.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'runId = :runId',
          ExpressionAttributeValues: { ':runId': runId },
          ProjectionExpression: 'seq',
          ScanIndexForward: false,
          ConsistentRead: true,
          Limit: 1,
        }),
      )
      const seq = result.Items?.[0]?.seq
      return typeof seq === 'number' ? seq : 0
    },
  }
}
