// Stripe Checkout over its HTTP API (no SDK): https://docs.stripe.com/api/checkout/sessions/create
import { z } from 'zod'
import type { CheckoutSessionRequest, PaymentsRepository } from '../types/index.js'

const REQUEST_TIMEOUT_MS = 15_000

const sessionSchema = z.object({ url: z.url() })

function sessionForm(request: CheckoutSessionRequest): URLSearchParams {
  const { pack } = request
  return new URLSearchParams({
    mode: 'payment',
    success_url: request.successUrl,
    cancel_url: request.cancelUrl,
    customer_email: request.email,
    client_reference_id: request.userId,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(pack.priceUsdCents),
    'line_items[0][price_data][product_data][name]': `Leadex: ${pack.credits.toLocaleString('en-US')} lead credits`,
    'metadata[packId]': pack.packId,
    'metadata[userId]': request.userId,
  })
}

export function createStripeRepository(apiUrl: string, secretKey: string): PaymentsRepository {
  return {
    async createCheckoutSession(request: CheckoutSessionRequest): Promise<string> {
      const response = await fetch(`${apiUrl}/v1/checkout/sessions`, {
        method: 'POST', body: sessionForm(request), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { authorization: `Bearer ${secretKey}`, 'content-type': 'application/x-www-form-urlencoded' },
      })
      if (!response.ok) throw new Error(`Stripe checkout failed: HTTP ${response.status}`)
      return sessionSchema.parse(await response.json()).url
    },
  }
}
