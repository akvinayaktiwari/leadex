// Creates the local stack's DynamoDB tables and SQS queue (DynamoDB Local and ElasticMQ). Used only by
// tools/local-setup.ts; in AWS the CDK stack creates them.
import { CreateTableCommand, DynamoDBClient, ListTablesCommand, type AttributeDefinition, type KeySchemaElement } from '@aws-sdk/client-dynamodb'
import { CreateQueueCommand, SQSClient } from '@aws-sdk/client-sqs'

export interface LocalTableDefinition {
  name: string
  partitionKey: string
  sortKey?: { name: string; type: 'S' | 'N' } | undefined
}

export interface LocalStackRepository {
  // Returns the names it created; existing tables are left as they are.
  ensureTables(tables: LocalTableDefinition[]): Promise<string[]>
  ensureQueue(name: string): Promise<string>
}

function keys(table: LocalTableDefinition): { attributes: AttributeDefinition[]; schema: KeySchemaElement[] } {
  const attributes: AttributeDefinition[] = [{ AttributeName: table.partitionKey, AttributeType: 'S' }]
  const schema: KeySchemaElement[] = [{ AttributeName: table.partitionKey, KeyType: 'HASH' }]
  if (table.sortKey) {
    attributes.push({ AttributeName: table.sortKey.name, AttributeType: table.sortKey.type })
    schema.push({ AttributeName: table.sortKey.name, KeyType: 'RANGE' })
  }
  return { attributes, schema }
}

export function createLocalStackRepository(region: string, dynamoEndpoint: string, sqsEndpoint: string): LocalStackRepository {
  const dynamo = new DynamoDBClient({ region, endpoint: dynamoEndpoint })
  const sqs = new SQSClient({ region, endpoint: sqsEndpoint })
  return {
    async ensureTables(tables: LocalTableDefinition[]): Promise<string[]> {
      const existing = new Set((await dynamo.send(new ListTablesCommand({}))).TableNames ?? [])
      const missing = tables.filter((table) => !existing.has(table.name))
      for (const table of missing) {
        const { attributes, schema } = keys(table)
        await dynamo.send(new CreateTableCommand({ TableName: table.name, BillingMode: 'PAY_PER_REQUEST', AttributeDefinitions: attributes, KeySchema: schema }))
      }
      return missing.map((table) => table.name)
    },
    async ensureQueue(name: string): Promise<string> {
      const result = await sqs.send(new CreateQueueCommand({ QueueName: name }))
      if (!result.QueueUrl) throw new Error(`Queue ${name} was not created`)
      return result.QueueUrl
    },
  }
}
