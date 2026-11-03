'use client'

import Script from 'next/script'
import { getPublicConfig } from '@/services/config'

const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
// The widget adds this hidden field to the surrounding form once the visitor passes the check.
const TOKEN_FIELD = 'cf-turnstile-response'

interface TurnstileGlobal {
  reset(): void
}

export function turnstileToken(form: HTMLFormElement): string | undefined {
  const value = new FormData(form).get(TOKEN_FIELD)
  return typeof value === 'string' && value ? value : undefined
}

// A token is good for one request; after a refusal the visitor needs a new one.
export function resetTurnstile(): void {
  const turnstile = (window as Window & { turnstile?: TurnstileGlobal }).turnstile
  turnstile?.reset()
}

export function TurnstileWidget() {
  const { turnstileSiteKey } = getPublicConfig()
  if (!turnstileSiteKey) return null
  return (
    <>
      <Script src={TURNSTILE_SCRIPT} strategy="afterInteractive" />
      <div className="cf-turnstile" data-sitekey={turnstileSiteKey} />
    </>
  )
}
