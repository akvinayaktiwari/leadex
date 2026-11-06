// Buying credits (#8): Stripe Checkout for a pack, and the webhook that grants the credits once per Stripe event.
// No auto-recharge; each purchase is explicit and checked against the user's own monthly cap.
import { logInfo } from '../lib/logger.js'
import type { Clock, CreditPack, CreditsRepository, PaymentsRepository, PaymentsService, StartCheckoutResult, StripeWebhookEvent, WebhookResult } from '../types/index.js'

const MAX_MONTHLY_CAP_USD = 100_000

export interface PaymentsServiceDeps {
  credits: CreditsRepository
  payments: PaymentsRepository
  packs: readonly CreditPack[]
  clock: Clock
  frontendUrl: string
}

// The cap to check: a newly given one (validated and saved) or the account's saved one.
async function resolveCap(deps: PaymentsServiceDeps, userId: string, saved: number | undefined, givenUsd: number | undefined): Promise<number | 'invalid' | undefined> {
  if (givenUsd === undefined) return saved
  if (!Number.isInteger(givenUsd) || givenUsd < 1 || givenUsd > MAX_MONTHLY_CAP_USD) return 'invalid'
  await deps.credits.setMonthlyCap(userId, givenUsd * 100)
  return givenUsd * 100
}

async function startCheckout(deps: PaymentsServiceDeps, userId: string, packId: string, monthlyCapUsd?: number): Promise<StartCheckoutResult> {
  const pack = deps.packs.find((candidate) => candidate.packId === packId)
  if (!pack) return { ok: false, code: 'unknown_pack' }
  const account = await deps.credits.getAccount(userId)
  if (!account) throw new Error(`No account for ${userId}; it is created at sign-in`)
  const cap = await resolveCap(deps, userId, account.monthlyCapUsdCents, monthlyCapUsd)
  if (cap === 'invalid') return { ok: false, code: 'invalid_cap' }
  if (cap === undefined) return { ok: false, code: 'monthly_cap_required' }
  const spent = await deps.credits.purchasedInMonth(userId, deps.clock.now().toISOString().slice(0, 7))
  if (spent + pack.priceUsdCents > cap) return { ok: false, code: 'monthly_cap_reached' }
  const checkoutUrl = await deps.payments.createCheckoutSession({
    userId, email: account.email, pack, successUrl: `${deps.frontendUrl}/credits?purchase=done`, cancelUrl: `${deps.frontendUrl}/credits`,
  })
  return { ok: true, checkoutUrl }
}

// Grants the pack's credits (from our own pack list, never from the event) once per Stripe event id.
async function handleEvent(deps: PaymentsServiceDeps, event: StripeWebhookEvent): Promise<WebhookResult> {
  const { session } = event
  if (!session?.paid) return 'ignored'
  const pack = deps.packs.find((candidate) => candidate.packId === session.packId)
  if (!pack || session.amountUsdCents < pack.priceUsdCents) {
    logInfo('stripe event not granted: unknown pack or underpaid', { eventId: event.id, packId: session.packId, amountUsdCents: session.amountUsdCents })
    return 'ignored'
  }
  const result = await deps.credits.apply({
    userId: session.userId, credits: pack.credits, kind: 'purchase', reference: event.id,
    idempotencyKey: `stripe#${event.id}`, at: deps.clock.now().toISOString(), amountUsdCents: session.amountUsdCents,
  })
  // 'insufficient' on a grant means the account is missing: throw so the webhook answers 500 and Stripe retries.
  if (result === 'insufficient') throw new Error(`Paid checkout for unknown account ${session.userId} (event ${event.id})`)
  return result === 'applied' ? 'granted' : 'duplicate'
}

export function createPaymentsService(deps: PaymentsServiceDeps): PaymentsService {
  return {
    startCheckout: (userId, packId, monthlyCapUsd) => startCheckout(deps, userId, packId, monthlyCapUsd),
    handleEvent: (event) => handleEvent(deps, event),
  }
}
