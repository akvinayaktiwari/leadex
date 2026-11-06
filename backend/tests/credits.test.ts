import { CreateTableCommand, DeleteTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { QueryCommand } from '@aws-sdk/lib-dynamodb'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDocumentClient } from '../src/lib/dynamo-client.js'
import { createCreditsTableRepository } from '../src/repositories/credits-table-repository.js'
import { FREE_CREDITS, createCreditsService } from '../src/services/credits-service.js'
import { manualClock } from './support/in-memory-run-store.js'

const ENDPOINT = process.env.DYNAMODB_ENDPOINT
const REGION = 'ap-south-1'
const SUFFIX = `${Date.now()}`
const TABLES = { users: `test-users-${SUFFIX}`, ledger: `test-ledger-${SUFFIX}` }

process.env.AWS_ACCESS_KEY_ID ??= 'local'
process.env.AWS_SECRET_ACCESS_KEY ??= 'local'

describe.runIf(ENDPOINT)('credits (DynamoDB Local)', () => {
  const raw = new DynamoDBClient({ region: REGION, ...(ENDPOINT ? { endpoint: ENDPOINT } : {}) })
  const client = createDocumentClient(REGION, ENDPOINT)
  const repository = createCreditsTableRepository(client, TABLES)
  const credits = createCreditsService({ repository, clock: manualClock() })

  beforeAll(async () => {
    await raw.send(new CreateTableCommand({ TableName: TABLES.users, BillingMode: 'PAY_PER_REQUEST', AttributeDefinitions: [{ AttributeName: 'userId', AttributeType: 'S' }], KeySchema: [{ AttributeName: 'userId', KeyType: 'HASH' }] }))
    await raw.send(new CreateTableCommand({
      TableName: TABLES.ledger, BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [{ AttributeName: 'userId', AttributeType: 'S' }, { AttributeName: 'entryKey', AttributeType: 'S' }],
      KeySchema: [{ AttributeName: 'userId', KeyType: 'HASH' }, { AttributeName: 'entryKey', KeyType: 'RANGE' }],
    }))
  })

  afterAll(async () => {
    for (const name of Object.values(TABLES)) await raw.send(new DeleteTableCommand({ TableName: name }))
  })

  const ledger = async (userId: string) => ((await client.send(new QueryCommand({ TableName: TABLES.ledger, KeyConditionExpression: 'userId = :u', ExpressionAttributeValues: { ':u': userId } }))).Items ?? [])
    .filter((item) => !String(item.entryKey).startsWith('once#'))

  // protects=acceptance criterion 7: concurrent debits can never drive the balance below 0 (conditional write), and each
  // successful debit leaves exactly one ledger entry;
  // fails_when=five parallel builds of 10 leads on 25 credits all succeed, or the balance goes negative;
  // no_claim=DynamoDB Local; AWS uses the same conditional transaction.
  it('never debits below zero, even in parallel', async () => {
    await credits.ensureAccount('user-parallel', 'parallel@gmail.com')
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => credits.charge('user-parallel', 10, `run_${n}`)))
    expect(results.filter((result) => result === 'applied')).toHaveLength(2)
    expect(results.filter((result) => result === 'insufficient')).toHaveLength(3)
    expect(await credits.balance('user-parallel')).toBe(FREE_CREDITS - 20)
    expect((await ledger('user-parallel')).map((entry) => entry.credits).sort()).toEqual([-10, -10, 25])
  })

  // protects=a retried charge for the same run is a duplicate, never a second debit;
  // fails_when=a worker retry after a timeout charges a build twice;
  // no_claim=n/a.
  it('charges a run once', async () => {
    await credits.ensureAccount('user-retry', 'retry@gmail.com')
    expect(await credits.charge('user-retry', 5, 'run_x')).toBe('applied')
    expect(await credits.charge('user-retry', 5, 'run_x')).toBe('duplicate')
    expect(await credits.balance('user-retry')).toBe(FREE_CREDITS - 5)
  })

  // protects=25 free credits once per user and once per company email domain (webmail per account), created atomically
  // with the account, and repeated or concurrent first sign-ins never grant twice;
  // fails_when=a second colleague at acme.com gets free credits, a Gmail user gets none, or two parallel first requests
  // grant 50;
  // no_claim=n/a.
  it('grants free credits once per user and per company domain', async () => {
    const [first, again] = await Promise.all([credits.ensureAccount('user-acme-1', 'a@acme.example'), credits.ensureAccount('user-acme-1', 'a@acme.example')])
    expect([first.creditBalance, again.creditBalance]).toEqual([FREE_CREDITS, FREE_CREDITS])
    expect((await credits.ensureAccount('user-acme-2', 'b@ACME.example')).creditBalance).toBe(0)
    expect((await credits.ensureAccount('user-gmail-1', 'x@gmail.com')).creditBalance).toBe(FREE_CREDITS)
    expect((await credits.ensureAccount('user-gmail-2', 'y@gmail.com')).creditBalance).toBe(FREE_CREDITS)
    expect(await ledger('user-acme-1')).toHaveLength(1)
    expect(await ledger('user-acme-2')).toHaveLength(0)
  })
})
