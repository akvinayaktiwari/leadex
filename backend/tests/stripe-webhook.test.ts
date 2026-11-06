import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { parseStripeEvent, verifyStripeSignature } from '../src/lib/stripe-webhook.js'

const SECRET = 'whsec_test'
const NOW = 1_793_900_000
const sign = (body: string, at: number, secret = SECRET): string => `t=${at},v1=${createHmac('sha256', secret).update(`${at}.${body}`).digest('hex')}`
const BODY = JSON.stringify({
  id: 'evt_1', type: 'checkout.session.completed',
  data: { object: { client_reference_id: 'user_1', payment_status: 'paid', amount_total: 4900, metadata: { packId: 'starter', userId: 'user_1' } } },
})

describe('Stripe webhook', () => {
  // protects=only a body signed with our webhook secret within 5 minutes is accepted, compared in constant time;
  // fails_when=a forged or edited body, another secret, or a replay from an hour ago grants credits;
  // no_claim=Stripe's own delivery is not exercised; signatures are made the way Stripe documents.
  it('accepts only fresh bodies signed with our secret', () => {
    expect(verifyStripeSignature(BODY, sign(BODY, NOW), SECRET, NOW + 10)).toBe(true)
    expect(verifyStripeSignature(BODY.replace('4900', '490000'), sign(BODY, NOW), SECRET, NOW)).toBe(false)
    expect(verifyStripeSignature(BODY, sign(BODY, NOW, 'whsec_other'), SECRET, NOW)).toBe(false)
    expect(verifyStripeSignature(BODY, sign(BODY, NOW - 3_600), SECRET, NOW)).toBe(false)
    expect(verifyStripeSignature(BODY, `t=${NOW},v1=00,${sign(BODY, NOW).split(',')[1]}`, SECRET, NOW)).toBe(true)
    expect(verifyStripeSignature(BODY, 'garbage', SECRET, NOW)).toBe(false)
  })

  // protects=a completed checkout is read into user, pack, paid and amount; other events and bad bodies grant nothing;
  // fails_when=an unpaid or unrelated event is treated as a paid checkout, or a malformed body throws;
  // no_claim=n/a.
  it('reads paid checkouts only', () => {
    expect(parseStripeEvent(BODY)).toEqual({ id: 'evt_1', type: 'checkout.session.completed', session: { userId: 'user_1', packId: 'starter', paid: true, amountUsdCents: 4900 } })
    expect(parseStripeEvent(JSON.stringify({ id: 'evt_2', type: 'invoice.paid', data: { object: {} } }))).toEqual({ id: 'evt_2', type: 'invoice.paid' })
    expect(parseStripeEvent(BODY.replace('"paid"', '"unpaid"'))?.session?.paid).toBe(false)
    expect(parseStripeEvent('not json')).toBeUndefined()
  })
})
