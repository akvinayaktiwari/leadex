import { CreateTableCommand, DeleteTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CREDIT_PACKS } from '../src/config/credit-packs.js'
import { createDocumentClient } from '../src/lib/dynamo-client.js'
import { createCreditsTableRepository } from '../src/repositories/credits-table-repository.js'
import { createStripeRepository } from '../src/repositories/stripe-repository.js'
import { FREE_CREDITS, createCreditsService } from '../src/services/credits-service.js'
import { createPaymentsService } from '../src/services/payments-service.js'
import type { StripeWebhookEvent } from '../src/types/index.js'
import { manualClock } from './support/in-memory-run-store.js'

const ENDPOINT = process.env.DYNAMODB_ENDPOINT
const REGION = 'ap-south-1'
const SUFFIX = `${Date.now()}`
const TABLES = { users: `test-pay-users-${SUFFIX}`, ledger: `test-pay-ledger-${SUFFIX}` }

process.env.AWS_ACCESS_KEY_ID ??= 'local'
process.env.AWS_SECRET_ACCESS_KEY ??= 'local'

const paid = (id: string, userId: string, packId = 'starter', amountUsdCents = 4_900): StripeWebhookEvent =>
  ({ id, type: 'checkout.session.completed', session: { userId, packId, paid: true, amountUsdCents } })

describe.runIf(ENDPOINT)('payments (DynamoDB Local, fake Stripe)', () => {
  const raw = new DynamoDBClient({ region: REGION, ...(ENDPOINT ? { endpoint: ENDPOINT } : {}) })
  const repository = createCreditsTableRepository(createDocumentClient(REGION, ENDPOINT), TABLES)
  const clock = manualClock('2026-11-06T10:00:00.000Z')
  const credits = createCreditsService({ repository, clock })
  const forms: URLSearchParams[] = []
  let stripe: Server
  let payments: ReturnType<typeof createPaymentsService>

  beforeAll(async () => {
    await raw.send(new CreateTableCommand({ TableName: TABLES.users, BillingMode: 'PAY_PER_REQUEST', AttributeDefinitions: [{ AttributeName: 'userId', AttributeType: 'S' }], KeySchema: [{ AttributeName: 'userId', KeyType: 'HASH' }] }))
    await raw.send(new CreateTableCommand({
      TableName: TABLES.ledger, BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [{ AttributeName: 'userId', AttributeType: 'S' }, { AttributeName: 'entryKey', AttributeType: 'S' }],
      KeySchema: [{ AttributeName: 'userId', KeyType: 'HASH' }, { AttributeName: 'entryKey', KeyType: 'RANGE' }],
    }))
    stripe = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk: Buffer) => { body += chunk.toString() })
      request.on('end', () => {
        forms.push(new URLSearchParams(body))
        const ok = request.headers.authorization === 'Bearer sk_test_1' && request.url === '/v1/checkout/sessions'
        response.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' }).end(JSON.stringify(ok ? { url: 'https://checkout.stripe.com/c/pay/cs_test_1' } : { error: {} }))
      })
    })
    await new Promise<void>((resolve) => stripe.listen(0, '127.0.0.1', resolve))
    const apiUrl = `http://127.0.0.1:${(stripe.address() as AddressInfo).port}`
    payments = createPaymentsService({ credits: repository, payments: createStripeRepository(apiUrl, 'sk_test_1'), packs: CREDIT_PACKS, clock, frontendUrl: 'https://leadex.example' })
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => stripe.close(() => resolve()))
    for (const name of Object.values(TABLES)) await raw.send(new DeleteTableCommand({ TableName: name }))
  })

  // protects=acceptance criterion 8: a Stripe webhook replayed 3 times with the same event id grants credits once; the
  // credits come from our pack list; unpaid, unknown-pack and underpaid sessions grant nothing;
  // fails_when=Stripe's retries triple a purchase, the event decides how many credits, or an unpaid session grants;
  // no_claim=fake events (signature checks are in stripe-webhook.test.ts).
  it('grants a paid checkout once, however often it is delivered', async () => {
    await credits.ensureAccount('user_buyer', 'buyer@gmail.com')
    const results = [await payments.handleEvent(paid('evt_a', 'user_buyer')), await payments.handleEvent(paid('evt_a', 'user_buyer')), await payments.handleEvent(paid('evt_a', 'user_buyer'))]
    expect(results).toEqual(['granted', 'duplicate', 'duplicate'])
    expect(await credits.balance('user_buyer')).toBe(FREE_CREDITS + 250)
    expect(await payments.handleEvent({ ...paid('evt_b', 'user_buyer'), session: { userId: 'user_buyer', packId: 'starter', paid: false, amountUsdCents: 4_900 } })).toBe('ignored')
    expect(await payments.handleEvent(paid('evt_c', 'user_buyer', 'made_up'))).toBe('ignored')
    expect(await payments.handleEvent(paid('evt_d', 'user_buyer', 'growth', 100))).toBe('ignored')
    expect(await credits.balance('user_buyer')).toBe(FREE_CREDITS + 250)
    await expect(payments.handleEvent(paid('evt_e', 'user_missing'))).rejects.toThrow(/unknown account/)
  })

  // protects=checkout needs a monthly cap the first time, refuses a pack that would pass this month's cap, and otherwise
  // returns Stripe's URL for a session with our price, the user and the pack;
  // fails_when=a purchase starts with no cap, the cap is ignored, or the session charges another amount or user;
  // no_claim=a fake Stripe server; real Stripe test mode is checked by hand before launch.
  it('checks the monthly cap and creates the session', async () => {
    await credits.ensureAccount('user_cap', 'cap@gmail.com')
    expect(await payments.startCheckout('user_cap', 'starter')).toEqual({ ok: false, code: 'monthly_cap_required' })
    expect(await payments.startCheckout('user_cap', 'starter', 0)).toEqual({ ok: false, code: 'invalid_cap' })
    expect(await payments.startCheckout('user_cap', 'nope', 100)).toEqual({ ok: false, code: 'unknown_pack' })
    expect(await payments.startCheckout('user_cap', 'starter', 60)).toEqual({ ok: true, checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_1' })
    const form = forms.at(-1)
    expect([form?.get('line_items[0][price_data][unit_amount]'), form?.get('client_reference_id'), form?.get('metadata[packId]'), form?.get('mode')]).toEqual(['4900', 'user_cap', 'starter', 'payment'])
    await payments.handleEvent(paid('evt_cap', 'user_cap'))
    expect(await payments.startCheckout('user_cap', 'starter')).toEqual({ ok: false, code: 'monthly_cap_reached' })
    clock.advance(31 * 24 * 60 * 60 * 1000)
    expect((await payments.startCheckout('user_cap', 'starter')).ok).toBe(true)
  })
})
