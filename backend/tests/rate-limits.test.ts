import { CreateTableCommand, DeleteTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDocumentClient } from '../src/lib/dynamo-client.js'
import { anonymousLimitKeys } from '../src/lib/rate-limit-keys.js'
import { createRateLimitsTableRepository } from '../src/repositories/rate-limits-table-repository.js'

const ENDPOINT = process.env.DYNAMODB_ENDPOINT
const REGION = 'ap-south-1'
const TABLE = `test-rate-limits-${Date.now()}`
const EXPIRES = '2026-11-05T00:00:00.000Z'

process.env.AWS_ACCESS_KEY_ID ??= 'local'
process.env.AWS_SECRET_ACCESS_KEY ??= 'local'

// protects=limit keys are per UTC day and never contain the raw IP or device id;
// fails_when=raw addresses are stored, or the day boundary is local time;
// no_claim=n/a.
it('hashes limit keys per UTC day', () => {
  const keys = anonymousLimitKeys('203.0.113.7', 'device-aaaa', new Date('2026-11-03T23:59:59.000Z'))
  expect(keys).toHaveLength(2)
  expect(keys.join(' ')).not.toMatch(/203\.0\.113\.7|device-aaaa/)
  expect(keys.every((key) => key.endsWith('#2026-11-03'))).toBe(true)
  expect(anonymousLimitKeys('203.0.113.7', undefined, new Date('2026-11-04T00:00:00.000Z'))).toEqual([keys[0]!.replace('2026-11-03', '2026-11-04')])
})

describe.runIf(ENDPOINT)('rate limits (DynamoDB Local)', () => {
  const raw = new DynamoDBClient({ region: REGION, ...(ENDPOINT ? { endpoint: ENDPOINT } : {}) })
  const limits = createRateLimitsTableRepository(createDocumentClient(REGION, ENDPOINT), TABLE)

  beforeAll(async () => {
    await raw.send(new CreateTableCommand({
      TableName: TABLE, BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [{ AttributeName: 'key', AttributeType: 'S' }], KeySchema: [{ AttributeName: 'key', KeyType: 'HASH' }],
    }))
  })

  afterAll(async () => {
    await raw.send(new DeleteTableCommand({ TableName: TABLE }))
  })

  // protects=each key allows exactly `limit` uses, and a request refused by one key counts nothing on the others (one transaction);
  // fails_when=a 4th use passes, a refused request still uses up the other key's quota, or the condition error escapes as a 500;
  // no_claim=does not test two Lambdas racing (DynamoDB transactions serialize them).
  it('allows up to the limit on every key, all or nothing', async () => {
    for (let i = 0; i < 3; i += 1) expect(await limits.consume(['ip#a', 'device#x'], 3, EXPIRES)).toBe(true)
    expect(await limits.consume(['ip#a', 'device#y'], 3, EXPIRES)).toBe(false)
    expect(await limits.consume(['ip#b', 'device#x'], 3, EXPIRES)).toBe(false)
    // device#y and ip#b were not counted by the refused requests.
    for (let i = 0; i < 3; i += 1) expect(await limits.consume(['ip#b', 'device#y'], 3, EXPIRES)).toBe(true)
    expect(await limits.consume(['ip#b'], 3, EXPIRES)).toBe(false)
  })
})
