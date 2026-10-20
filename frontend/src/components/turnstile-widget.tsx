'use client'

import Script from 'next/script'
import { getPublicConfig } from '@/services/config'

const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js'

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
