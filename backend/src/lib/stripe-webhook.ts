// Verifies a Stripe webhook (https://docs.stripe.com/webhooks#verify-manually) and reads the fields Leadex uses.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { StripeWebhookEvent } from '../types/index.js'

// Stripe's default tolerance: a signed payload older than this is a replay.
const TOLERANCE_SECONDS = 300

const eventSchema = z.object({
  id: z.string().min(1),
  type: z.string(),
  data: z.object({ object: z.record(z.string(), z.unknown()) }),
})

const sessionSchema = z.object({
  client_reference_id: z.string().min(1),
  payment_status: z.string(),
  amount_total: z.number(),
  metadata: z.object({ packId: z.string().min(1) }),
})

function signatureParts(header: string): { timestamp: number; signatures: string[] } {
  const parts = header.split(',').map((part) => part.split('=') as [string, string | undefined])
  const timestamp = Number(parts.find(([key]) => key === 't')?.[1])
  const signatures = parts.filter(([key, value]) => key === 'v1' && value).map(([, value]) => value ?? '')
  return { timestamp, signatures }
}

function sameSignature(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(actual, 'hex')
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b)
}

export function verifyStripeSignature(rawBody: string, header: string, secret: string, nowSeconds: number): boolean {
  const { timestamp, signatures } = signatureParts(header)
  if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > TOLERANCE_SECONDS) return false
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
  return signatures.some((signature) => sameSignature(expected, signature))
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    // Not JSON: the caller treats it like any other body that is not a Stripe event.
    return undefined
  }
}

// The event with its Checkout session fields, or undefined when the body is not a Stripe event.
export function parseStripeEvent(rawBody: string): StripeWebhookEvent | undefined {
  const event = eventSchema.safeParse(parseJson(rawBody))
  if (!event.success) return undefined
  const { id, type } = event.data
  if (type !== 'checkout.session.completed') return { id, type }
  const session = sessionSchema.safeParse(event.data.data.object)
  if (!session.success) return { id, type }
  const { client_reference_id: userId, payment_status: status, amount_total: amountUsdCents, metadata } = session.data
  return { id, type, session: { userId, packId: metadata.packId, paid: status === 'paid', amountUsdCents } }
}
