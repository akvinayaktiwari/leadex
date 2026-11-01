// Bouncer real-time verification (GET {base}/v1.1/email/verify?email=…, header x-api-key).
import { z } from 'zod'
import { VerifierOutOfCredits, VerifierRateLimited } from '../lib/errors.js'
import type { EmailVerifier, VerificationResult, VerificationStatus } from '../types/index.js'

const yesNo = z.enum(['yes', 'no', 'unknown']).optional()
const responseSchema = z.object({
  email: z.string(),
  status: z.enum(['deliverable', 'risky', 'undeliverable', 'unknown']),
  reason: z.string(),
  domain: z.object({ acceptAll: yesNo, disposable: yesNo }).partial().optional(),
  account: z.object({ role: yesNo, disabled: yesNo, fullMailbox: yesNo }).partial().optional(),
  score: z.number().optional(),
  toxicity: z.number().optional(),
  retryAfter: z.string().optional(),
})

type BouncerResponse = z.infer<typeof responseSchema>

// Addresses tied to spam traps or complaints (toxicity 3-5) are never delivered: they hurt the sender's reputation.
const TOXIC_FROM = 3
const REQUEST_TIMEOUT_SECONDS = 15

// Conservative: 'valid' only for a deliverable address on a domain that does not accept everything, with no risk flags.
export function toStatus(response: BouncerResponse): VerificationStatus {
  const acceptAll = response.domain?.acceptAll === 'yes'
  if (response.status === 'undeliverable' || response.domain?.disposable === 'yes') return 'invalid'
  if ((response.toxicity ?? 0) >= TOXIC_FROM || response.account?.disabled === 'yes' || response.account?.fullMailbox === 'yes') return 'invalid'
  if (acceptAll) return 'catch_all'
  if (response.status === 'deliverable') return 'valid'
  return 'unknown'
}

export function createBouncerVerifier(baseUrl: string, apiKey: string): EmailVerifier {
  return {
    name: 'bouncer',
    async verify(email: string): Promise<VerificationResult> {
      const url = new URL('/v1.1/email/verify', baseUrl)
      url.searchParams.set('email', email)
      url.searchParams.set('timeout', String(REQUEST_TIMEOUT_SECONDS - 5))
      const response = await fetch(url, { headers: { 'x-api-key': apiKey }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_SECONDS * 1000) })
      if (response.status === 402) throw new VerifierOutOfCredits('bouncer')
      if (response.status === 429) throw new VerifierRateLimited('bouncer')
      if (!response.ok) throw new Error(`bouncer: HTTP ${response.status}`)
      const body = responseSchema.parse(await response.json())
      return { email, status: toStatus(body), reason: `${body.status}:${body.reason}`, score: body.score, retryAfter: body.retryAfter }
    },
  }
}
