'use client'

// The user's corrections to product claims, kept per domain in the browser until a lead build sends them (#12).
import { useCallback, useEffect, useState } from 'react'

export type Corrections = Record<string, string>

const storageKey = (domain: string): string => `leadex:corrections:${domain}`

function load(domain: string): Corrections {
  try {
    const raw = window.localStorage.getItem(storageKey(domain))
    return raw ? (JSON.parse(raw) as Corrections) : {}
  } catch {
    // Storage blocked (private mode) or corrupted: corrections still work for this visit.
    return {}
  }
}

function save(domain: string, corrections: Corrections): void {
  try {
    window.localStorage.setItem(storageKey(domain), JSON.stringify(corrections))
  } catch {
    // Same as above: the page keeps working without persistence.
  }
}

export function claimKey(field: string, index: number): string {
  return `${field}:${index}`
}

export function useClaimCorrections(domain: string): { corrections: Corrections; correct: (key: string, text: string) => void } {
  const [corrections, setCorrections] = useState<Corrections>({})
  useEffect(() => setCorrections(load(domain)), [domain])
  const correct = useCallback((key: string, text: string) => {
    setCorrections((current) => {
      const next = { ...current, [key]: text }
      save(domain, next)
      return next
    })
  }, [domain])
  return { corrections, correct }
}
