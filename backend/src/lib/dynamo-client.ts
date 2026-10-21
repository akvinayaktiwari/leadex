import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'

export function createDocumentClient(region: string, endpoint?: string): DynamoDBDocumentClient {
  const client = new DynamoDBClient({ region, ...(endpoint ? { endpoint } : {}) })
  return DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } })
}
