// Pure rules that turn the model's segment draft into IcpSegments a lead build can search with (#5).
import { createHash } from 'node:crypto'
import { isAllowedCountry, normalizeCountry } from '../lib/countries.js'
import type { SegmentsDraft } from '../lib/schemas.js'
import type { IcpSegment, ProductProfile } from '../types/index.js'

type DraftSegment = SegmentsDraft['segments'][number]

// Integer shares summing to exactly 100, proportional to the model's weights (largest remainder; equal split if all zero).
export function normalizeShares(weights: number[]): number[] {
  if (weights.length === 0) return []
  const safe = weights.map((weight) => (Number.isFinite(weight) && weight > 0 ? weight : 0))
  const total = safe.reduce((sum, weight) => sum + weight, 0)
  const exact = total === 0 ? safe.map(() => 100 / safe.length) : safe.map((weight) => (weight / total) * 100)
  const floors = exact.map(Math.floor)
  let missing = 100 - floors.reduce((sum, value) => sum + value, 0)
  const byRemainder = exact.map((value, index) => ({ index, remainder: value - Math.floor(value) })).sort((a, b) => b.remainder - a.remainder || a.index - b.index)
  for (const { index } of byRemainder) {
    if (missing === 0) break
    floors[index] = (floors[index] ?? 0) + 1
    missing -= 1
  }
  return floors
}

// Segment countries limited to markets the business serves and that v1 can deliver (no EU/EEA/UK).
// An empty result means "any allowed country" (the lead build still enforces the EU/UK block).
export function segmentCountries(requested: string[], profile: ProductProfile): string[] {
  const global = profile.servedMarkets.includes('GLOBAL')
  const allowedServed = profile.servedMarkets.filter((code) => code !== 'GLOBAL' && isAllowedCountry(code))
  const kept = [...new Set(requested.map((code) => normalizeCountry(code)).filter((code): code is string => code !== undefined))]
    .filter((code) => isAllowedCountry(code) && (global || allowedServed.includes(code)))
  return kept.length > 0 ? kept : allowedServed
}

const clean = (values: string[], lower: boolean): string[] =>
  [...new Set(values.map((value) => (lower ? value.trim().toLowerCase() : value.trim())).filter((value) => value !== ''))]

function segmentId(domain: string, name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'segment'
  return `${slug}-${createHash('sha256').update(`${domain}|${name.toLowerCase()}`).digest('hex').slice(0, 6)}`
}

function toSegment(draft: DraftSegment, share: number, profile: ProductProfile): IcpSegment {
  const [min, max] = draft.employeeMax > 0 && draft.employeeMin > draft.employeeMax ? [draft.employeeMax, draft.employeeMin] : [draft.employeeMin, draft.employeeMax]
  return {
    segmentId: segmentId(profile.domain, draft.name), name: draft.name.trim(), useCase: draft.useCase.trim(), pain: draft.pain.trim(),
    criteria: clean(draft.criteria, false), buyerTitles: clean(draft.buyerTitles, false), sharePct: share,
    filters: {
      industries: [...new Set(draft.industries)], employeeMin: min, employeeMax: max, countries: segmentCountries(draft.countries, profile),
      keywords: clean(draft.keywords, true), technologies: clean(draft.technologies, true),
    },
  }
}

// Duplicate names (case-insensitive) are merged into the first, adding their share.
export function buildSegments(draft: SegmentsDraft, profile: ProductProfile): IcpSegment[] {
  const unique = new Map<string, DraftSegment>()
  for (const segment of draft.segments) {
    const key = segment.name.trim().toLowerCase()
    const existing = unique.get(key)
    if (existing) existing.sharePct += segment.sharePct
    else unique.set(key, { ...segment })
  }
  const segments = [...unique.values()]
  const shares = normalizeShares(segments.map((segment) => segment.sharePct))
  return segments.map((segment, index) => toSegment(segment, shares[index] ?? 0, profile))
}
