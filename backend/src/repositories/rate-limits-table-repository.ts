import { TransactionCanceledException } from '@aws-sdk/client-dynamodb'
import { TransactWriteCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import type { RateLimitRepository } from '../types/index.js'

const isLimitReached = (error: unknown): boolean =>
  error instanceof TransactionCanceledException && (error.CancellationReasons ?? []).some((reason) => reason.Code === 'ConditionalCheckFailed')

// All keys are counted in one transaction, so a request refused by one limit does not use up another.
export function createRateLimitsTableRepository(client: DynamoDBDocumentClient, tableName: string): RateLimitRepository {
  return {
    async consume(keys: string[], limit: number, expiresAt: string): Promise<boolean> {
      const expiresAtSeconds = Math.floor(Date.parse(expiresAt) / 1000)
      try {
        await client.send(new TransactWriteCommand({
          TransactItems: [...new Set(keys)].map((key) => ({
            Update: {
              TableName: tableName,
              Key: { key },
              UpdateExpression: 'ADD #count :one SET expiresAt = if_not_exists(expiresAt, :expiresAt)',
              ConditionExpression: 'attribute_not_exists(#count) OR #count < :limit',
              ExpressionAttributeNames: { '#count': 'count' },
              ExpressionAttributeValues: { ':one': 1, ':limit': limit, ':expiresAt': expiresAtSeconds },
            },
          })),
        }))
        return true
      } catch (error) {
        if (isLimitReached(error)) return false
        throw error
      }
    },
  }
}
