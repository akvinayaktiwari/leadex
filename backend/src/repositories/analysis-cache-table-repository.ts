import { GetCommand, PutCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { z } from 'zod'
import { runEventSchema } from '../lib/schemas.js'
import type { AnalysisCacheRepository, CachedAnalysis } from '../types/index.js'

interface StoredAnalysis {
  domain: string
  pipelineVersion: string
  sourceRunId: string
  // The events as JSON, so artifact payloads round-trip exactly (no DynamoDB type coercion).
  payload: string
  createdAt: string
  // Epoch seconds for the table's TTL; DynamoDB deletes late, so reads also check it.
  expiresAt: number
}

const eventsSchema = z.array(runEventSchema)

function toItem(entry: CachedAnalysis): StoredAnalysis {
  const { events, expiresAt, ...rest } = entry
  return { ...rest, payload: JSON.stringify(events), expiresAt: Math.floor(Date.parse(expiresAt) / 1000) }
}

function fromItem(item: Record<string, unknown>): CachedAnalysis {
  const { domain, pipelineVersion, sourceRunId, payload, createdAt, expiresAt } = item
  if (typeof domain !== 'string' || typeof pipelineVersion !== 'string' || typeof sourceRunId !== 'string'
    || typeof payload !== 'string' || typeof createdAt !== 'string' || typeof expiresAt !== 'number') {
    throw new Error('Cached analysis is malformed')
  }
  const events = eventsSchema.safeParse(JSON.parse(payload))
  if (!events.success) throw new Error(`Cached analysis events are malformed: ${events.error.message}`)
  return { domain, pipelineVersion, sourceRunId, events: events.data, createdAt, expiresAt: new Date(expiresAt * 1000).toISOString() }
}

export function createAnalysisCacheTableRepository(client: DynamoDBDocumentClient, tableName: string): AnalysisCacheRepository {
  return {
    async get(domain: string, pipelineVersion: string): Promise<CachedAnalysis | undefined> {
      const result = await client.send(new GetCommand({ TableName: tableName, Key: { domain, pipelineVersion } }))
      return result.Item ? fromItem(result.Item) : undefined
    },
    async put(entry: CachedAnalysis): Promise<void> {
      await client.send(new PutCommand({ TableName: tableName, Item: toItem(entry) }))
    },
  }
}
