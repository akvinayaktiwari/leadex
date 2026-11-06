'use client'

import { useState } from 'react'
import { claimKey, type Corrections } from '@/hooks/use-claim-corrections'
import type { ProductProfile, ProfileClaim } from '@/types'

const FIELD_LABEL: Record<ProfileClaim['field'], string> = { oneLiner: 'What you sell', category: 'Category', valueProp: 'Strength', pricingSignal: 'Pricing' }

// "2 Nov 2026": the month as a word, so no reader takes 2 Nov for 11 Feb.
const READ_DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

function sourceLabel(url: string): string {
  if (!url) return ''
  const parsed = new URL(url)
  return parsed.pathname === '/' ? parsed.hostname : parsed.pathname
}

interface ClaimProps {
  claim: ProfileClaim
  id: string
  crawledAt: string
  corrected: string | undefined
  onCorrect: (text: string) => void
}

function ClaimRow({ claim, id, crawledAt, corrected, onCorrect }: ClaimProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(corrected ?? claim.text)
  const date = READ_DATE.format(new Date(crawledAt))
  if (editing) {
    return (
      <li className="claim">
        <label htmlFor={id} className="claim-field">{FIELD_LABEL[claim.field]}</label>
        <input id={id} value={draft} onChange={(event) => setDraft(event.target.value)} />
        <button type="button" onClick={() => { onCorrect(draft.trim() || claim.text); setEditing(false) }}>Save</button>
        <button type="button" className="link-button" onClick={() => { setDraft(corrected ?? claim.text); setEditing(false) }}>Cancel</button>
      </li>
    )
  }
  return (
    <li className="claim">
      <span className="claim-field">{FIELD_LABEL[claim.field]}</span>
      <span className="claim-text">{corrected ?? claim.text}{corrected ? <em className="corrected"> (corrected by you)</em> : null}</span>
      <span className="claim-source">
        {claim.sourceUrl ? <><a href={claim.sourceUrl} target="_blank" rel="noreferrer">{sourceLabel(claim.sourceUrl)}</a> · read {date}</> : <span className="status-bad">No source, check this</span>}
      </span>
      <button type="button" className="link-button" aria-label={`Correct "${corrected ?? claim.text}"`} onClick={() => setEditing(true)}>Correct this</button>
    </li>
  )
}

export function ProfileCard({ profile, corrections, onCorrect }: { profile: ProductProfile; corrections: Corrections; onCorrect: (key: string, text: string) => void }) {
  const counts = new Map<string, number>()
  return (
    <section className="panel" aria-label="Your business">
      <h2>{profile.name}</h2>
      <ul className="claims">
        {profile.claims.map((claim) => {
          const index = counts.get(claim.field) ?? 0
          counts.set(claim.field, index + 1)
          const key = claimKey(claim.field, index)
          return <ClaimRow key={key} id={`claim-${key}`} claim={claim} crawledAt={profile.crawledAt} corrected={corrections[key]} onCorrect={(text) => onCorrect(key, text)} />
        })}
      </ul>
      <p className="hint">Sells in: {profile.servedMarkets.join(', ')}</p>
    </section>
  )
}
