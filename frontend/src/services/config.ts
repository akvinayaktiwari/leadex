import type { PublicConfig } from '@/types'

// NEXT_PUBLIC_* values are inlined at build time; each must be referenced literally.
export function getPublicConfig(): PublicConfig {
  return {
    apiUrl: process.env.NEXT_PUBLIC_API_URL ?? '',
    turnstileSiteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '',
  }
}
