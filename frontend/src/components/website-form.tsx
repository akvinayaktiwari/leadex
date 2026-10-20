'use client'

import { useState, type FormEvent } from 'react'
import { TurnstileWidget } from './turnstile-widget'

const DOMAIN_PATTERN = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/.*)?$/i

export function WebsiteForm() {
  const [url, setUrl] = useState('')
  const [message, setMessage] = useState('')

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!DOMAIN_PATTERN.test(url.trim())) {
      setMessage('Enter a website like yourcompany.com')
      return
    }
    // Wired to POST /api/analyses once the run engine and analysis steps land (#3, #4).
    setMessage('Analysis is not live yet — this build is the scaffold.')
  }

  return (
    <form className="website-form" onSubmit={handleSubmit}>
      <label htmlFor="website">Your website</label>
      <div className="row">
        <input
          id="website"
          name="website"
          type="text"
          inputMode="url"
          autoComplete="url"
          placeholder="yourcompany.com"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
        <button type="submit">Find my buyers</button>
      </div>
      <TurnstileWidget />
      {message ? <p className="hint">{message}</p> : null}
    </form>
  )
}
