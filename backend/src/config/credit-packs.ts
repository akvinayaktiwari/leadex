// Credit packs sold through Stripe Checkout (spec "Credits"). Initial values: confirm before launch so gross margin is at
// least 60% at the measured cost per delivered lead (acceptance criterion 9).
import type { CreditPack } from '../types/index.js'

export const CREDIT_PACKS: readonly CreditPack[] = [
  { packId: 'starter', credits: 250, priceUsdCents: 4_900 },
  { packId: 'growth', credits: 1_000, priceUsdCents: 14_900 },
]
