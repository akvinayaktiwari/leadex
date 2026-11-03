'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { startAnalysis } from '@/services/api-client'
import { getPublicConfig } from '@/services/config'
import { getDeviceId } from '@/services/device-id'
import { TurnstileWidget, resetTurnstile, turnstileToken } from './turnstile-widget'

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
    <form className="website-form" onSubmit={(event) => void handleSubmit(event)}>
      <label htmlFor="website">Your website</label>
      <div className="row">
        <input id="website" name="website" type="text" inputMode="url" autoComplete="url" placeholder="yourcompany.com"
          value={url} onChange={(event) => setUrl(event.target.value)} disabled={busy} />
        <button type="submit" disabled={busy}>{busy ? 'Starting…' : 'Find my buyers'}</button>
      </div>
      <TurnstileWidget />
      {message ? <p className="hint" role="alert">{message}</p> : null}
    </form>
  )
}
