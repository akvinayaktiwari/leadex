// Pure rules of a lead build (#12): how many leads each segment gets, which candidates may become leads, and their order.
import { createHash } from 'node:crypto'
import type { IcpSegment, QualifiedLead } from '../types/index.js'

// Spec: at most the requested count + 30% candidates, so qualification has room to drop some.
const CANDIDATE_HEADROOM = 1.3
export const MIN_FIT_SCORE = 60

// Leads per segment in proportion to sharePct (largest remainder), every picked segment getting at least one when possible.
export function segmentTargets(segments: IcpSegment[], leadCount: number): Map<string, number> {
  const total = segments.reduce((sum, segment) => sum + Math.max(segment.sharePct, 1), 0)
  const exact = segments.map((segment) => ({ id: segment.segmentId, value: (leadCount * Math.max(segment.sharePct, 1)) / total }))
  const targets = new Map(exact.map((item) => [item.id, Math.floor(item.value)]))
  let left = leadCount - [...targets.values()].reduce((sum, value) => sum + value, 0)
  const byNeed = [...exact].sort((a, b) => (targets.get(a.id) === 0 ? -1 : 0) - (targets.get(b.id) === 0 ? -1 : 0) || (b.value % 1) - (a.value % 1))
  for (const item of byNeed) {
    if (left === 0) break
    targets.set(item.id, (targets.get(item.id) ?? 0) + 1)
    left -= 1
  }
  return targets
}

export const candidateCap = (target: number): number => Math.ceil(target * CANDIDATE_HEADROOM)

// The address must be at the company's own domain (or a subdomain of it), never a webmail or another company's.
export function emailMatchesDomain(email: string, domain: string): boolean {
  const host = email.toLowerCase().split('@')[1] ?? ''
  const own = domain.toLowerCase().replace(/^www\./, '')
  return host === own || host.endsWith(`.${own}`)
}

const LEGAL_WORDS = new Set(['the', 'and', 'of', 'co', 'company', 'inc', 'ltd', 'llc', 'llp', 'pvt', 'private', 'limited', 'group', 'corp', 'corporation', 'gmbh', 'sa', 'ag', 'plc', 'pte', 'bv'])

function nameTokens(name: string): string[] {
  return name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').split(/[^a-z0-9]+/).filter(Boolean)
}

// Normalized-token check (spec): the domain's main label must come from the company's name, so a lead never pairs one
// company's name with another company's website.
export function nameMatchesDomain(name: string, domain: string): boolean {
  const label = (domain.toLowerCase().replace(/^www\./, '').split('.')[0] ?? '').replace(/-/g, '')
  const tokens = nameTokens(name)
  if (!label || tokens.length === 0) return false
  if (tokens.some((token) => token.length >= 3 && !LEGAL_WORDS.has(token) && label.includes(token))) return true
  const joined = [tokens.join(''), tokens.join('').replace(/and/g, 'n'), tokens.filter((token) => token !== 'and').join('')]
  if (joined.some((squashed) => squashed.includes(label) || label.includes(squashed))) return true
  const initials = tokens.filter((token) => !LEGAL_WORDS.has(token)).map((token) => token[0]).join('')
  return initials.length >= 2 && label.startsWith(initials)
}

// Spec qualify rules that need no model: the email at the company's domain, and a name that fits the domain.
export function passesDeliveryRules(company: { name: string; domain: string }, email: string): boolean {
  return emailMatchesDomain(email, company.domain) && nameMatchesDomain(company.name, company.domain)
}

// Best fit first; on a tie, companies in the segment's first target country come first.
export function rankLeads(leads: QualifiedLead[], countries: string[]): QualifiedLead[] {
  const order = (country: string): number => {
    const index = countries.indexOf(country)
    return index === -1 ? countries.length : index
  }
  return [...leads].sort((a, b) => b.fitScore - a.fitScore || order(a.company.country) - order(b.company.country))
}

export function leadIdFor(runId: string, personKey: string): string {
  return `lead_${createHash('sha256').update(`${runId}|${personKey}`).digest('hex').slice(0, 24)}`
}
