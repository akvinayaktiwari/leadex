'use client'

import { useState, type FormEvent } from 'react'
import { ArrowRight, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { startAnalysis } from '@/services/api-client'
import { getPublicConfig } from '@/services/config'
import { getDeviceId } from '@/services/device-id'
import { TurnstileWidget, resetTurnstile, turnstileToken } from './turnstile-widget'
import { BUTTON_PRIMARY } from './ui/styles'

const DOMAIN_PATTERN = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/.*)?$/i

export function WebsiteForm() {
  const router = useRouter()
  const [url, setUrl] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!DOMAIN_PATTERN.test(url.trim())) {
      setMessage('Enter a website like yourcompany.com')
      return
    }
    const token = turnstileToken(event.currentTarget)
    if (getPublicConfig().turnstileSiteKey && !token) {
      setMessage('One moment: the human check below is still running')
      return
    }
    setBusy(true)
    setMessage('')
    const result = await startAnalysis(url.trim(), { deviceId: getDeviceId(), ...(token ? { turnstileToken: token } : {}) })
    if (result.ok) {
      router.push(`/analysis?run=${encodeURIComponent(result.runId)}&domain=${encodeURIComponent(result.domain)}`)
      return
    }
    setMessage(result.message)
    resetTurnstile()
    setBusy(false)
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)}>
      <label htmlFor="website" className="mb-2 block text-sm font-semibold text-gray-900">Your website</label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input id="website" name="website" type="text" inputMode="url" autoComplete="url" placeholder="yourcompany.com"
          value={url} onChange={(event) => setUrl(event.target.value)} disabled={busy}
          className="h-12 w-full min-w-0 sm:flex-1 rounded-xl border border-gray-200 bg-[#f5f5fa] px-4 text-base text-gray-900 placeholder:text-gray-400 focus:border-violet-400 focus:bg-white disabled:opacity-60" />
        <button type="submit" disabled={busy} className={BUTTON_PRIMARY}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {busy ? 'Starting…' : 'Find my buyers'}
          {busy ? null : <ArrowRight className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
      <TurnstileWidget />
      {message ? <p className="mt-3 text-sm text-red-600" role="alert">{message}</p> : null}
    </form>
  )
}
