import { z } from 'zod'
import type { TurnstileRepository } from '../types/index.js'

const VERIFY_TIMEOUT_MS = 10_000

const verifyResponseSchema = z.object({ success: z.boolean(), 'error-codes': z.array(z.string()).optional() })

// Cloudflare Turnstile siteverify: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
export function createTurnstileRepository(verifyUrl: string, secret: string): TurnstileRepository {
  return {
    async verify(token: string, ip: string): Promise<boolean> {
      const body = new URLSearchParams({ secret, response: token, ...(ip === 'unknown' ? {} : { remoteip: ip }) })
      const response = await fetch(verifyUrl, { method: 'POST', body, signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS) })
      if (!response.ok) throw new Error(`Turnstile verify failed: HTTP ${response.status}`)
      return verifyResponseSchema.parse(await response.json()).success
    },
  }
}
