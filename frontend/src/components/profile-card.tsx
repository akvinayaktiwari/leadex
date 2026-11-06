'use client'

import { useState } from 'react'
import { claimKey, type Corrections } from '@/hooks/use-claim-corrections'
import type { ProductProfile, ProfileClaim } from '@/types'
import { BUTTON_LINK, CARD } from './ui/styles'

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

function ClaimSource({ claim, date }: { claim: ProfileClaim; date: string }) {
  if (!claim.sourceUrl) {
    return <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-700">No source, check this</span>
  }
  return <><a href={claim.sourceUrl} target="_blank" rel="noreferrer" className="text-violet-700 hover:underline">{sourceLabel(claim.sourceUrl)}</a> · read {date}</>
}

function ClaimEditor({ id, label, draft, setDraft, onSave, onCancel }: { id: string; label: string; draft: string; setDraft: (value: string) => void; onSave: () => void; onCancel: () => void }) {
  return (
    <li className="py-4">
      <label htmlFor={id} className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</label>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input id={id} value={draft} onChange={(event) => setDraft(event.target.value)}
          className="h-10 w-full min-w-0 sm:flex-1 rounded-xl border border-gray-200 bg-[#f5f5fa] px-3 text-sm focus:border-violet-400 focus:bg-white" />
        <div className="flex items-center gap-3">
          <button type="button" onClick={onSave} className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700">Save</button>
          <button type="button" onClick={onCancel} className={BUTTON_LINK}>Cancel</button>
        </div>
      </div>
    </li>
  )
}

function ClaimRow({ claim, id, crawledAt, corrected, onCorrect }: ClaimProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(corrected ?? claim.text)
  const date = READ_DATE.format(new Date(crawledAt))
  if (editing) {
    const save = (): void => { onCorrect(draft.trim() || claim.text); setEditing(false) }
    const cancel = (): void => { setDraft(corrected ?? claim.text); setEditing(false) }
    return <ClaimEditor id={id} label={FIELD_LABEL[claim.field]} draft={draft} setDraft={setDraft} onSave={save} onCancel={cancel} />
  }
  return (
    <li className="grid gap-1 py-4 sm:grid-cols-[8rem_1fr_auto] sm:items-baseline sm:gap-4">
      <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{FIELD_LABEL[claim.field]}</span>
      <div>
        <p className="text-gray-900">{corrected ?? claim.text}{corrected ? <em className="ml-1.5 text-xs not-italic font-semibold text-violet-600">(corrected by you)</em> : null}</p>
        <p className="mt-1 text-xs text-gray-500"><ClaimSource claim={claim} date={date} /></p>
      </div>
      <button type="button" className={`${BUTTON_LINK} justify-self-start`} aria-label={`Correct "${corrected ?? claim.text}"`} onClick={() => setEditing(true)}>Correct this</button>
    </li>
  )
}

export function ProfileCard({ profile, corrections, onCorrect }: { profile: ProductProfile; corrections: Corrections; onCorrect: (key: string, text: string) => void }) {
  const counts = new Map<string, number>()
  return (
    <section className={CARD} aria-label="Your business">
      <h2 className="mb-1 text-xl font-bold text-gray-900">{profile.name}</h2>
      <p className="mb-2 text-sm text-gray-500">Taken from your website. Correct anything we got wrong.</p>
      <ul className="divide-y divide-gray-100">
        {profile.claims.map((claim) => {
          const index = counts.get(claim.field) ?? 0
          counts.set(claim.field, index + 1)
          const key = claimKey(claim.field, index)
          return <ClaimRow key={key} id={`claim-${key}`} claim={claim} crawledAt={profile.crawledAt} corrected={corrections[key]} onCorrect={(text) => onCorrect(key, text)} />
        })}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Sells in</span>
        {profile.servedMarkets.map((market) => (
          <span key={market} className="rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-semibold text-violet-700">{market}</span>
        ))}
      </div>
    </section>
  )
}
