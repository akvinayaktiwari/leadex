// Pure rules for #24: learn a company's email format from evidence, and choose which addresses to verify for a person.
import { EMAIL_PATTERNS, addressFor, nameParts, patternsMatching, type EmailPattern } from '../lib/email-patterns.js'
import type { EmployeeBand } from '../types/index.js'

export type EvidenceStrength = 'verified' | 'published_linked' | 'published_unlinked'

export interface PatternEvidence {
  email: string
  strength: EvidenceStrength
  // Known for verified and linked addresses; absent for an unlinked published address.
  firstName?: string | undefined
  lastName?: string | undefined
}

export interface PatternGuess {
  pattern?: EmailPattern | undefined
  weight: number
  confident: boolean
  // Total evidence weight per format, for logging and storage.
  weights: Partial<Record<EmailPattern, number>>
}

const WEAK = 0.5

// Without names, only two shapes say something: "jane.doe" (first.last or last.first: credited to the far more common
// first.last) and "j.doe" (f.last). A lone dotless address ("kmorrow") is ambiguous and teaches nothing.
function unlinkedFormat(email: string): EmailPattern | undefined {
  const local = email.split('@')[0] ?? ''
  if (/^[a-z]{2,}\.[a-z]{2,}$/.test(local)) return 'first.last'
  if (/^[a-z]\.[a-z]{2,}$/.test(local)) return 'f.last'
  return undefined
}

function credit(item: PatternEvidence): Partial<Record<EmailPattern, number>> {
  if (item.strength === 'published_unlinked') {
    const format = unlinkedFormat(item.email)
    return format ? { [format]: WEAK } : {}
  }
  const name = nameParts(item.firstName ?? '', item.lastName ?? '')
  const matches = name ? patternsMatching(item.email.split('@')[0] ?? '', name) : []
  return Object.fromEntries(matches.map((pattern) => [pattern, 1 / matches.length]))
}

export function inferPattern(evidence: PatternEvidence[]): PatternGuess {
  const weights: Partial<Record<EmailPattern, number>> = {}
  for (const item of evidence) {
    for (const [pattern, weight] of Object.entries(credit(item)) as [EmailPattern, number][]) weights[pattern] = (weights[pattern] ?? 0) + weight
  }
  const ranked = (Object.entries(weights) as [EmailPattern, number][]).sort((a, b) => b[1] - a[1])
  const [top, second] = ranked
  if (!top) return { weight: 0, confident: false, weights }
  const confident = top[1] >= 1 && top[1] >= 2 * (second?.[1] ?? 0)
  return { pattern: top[0], weight: top[1], confident, weights }
}

const SMALL_BANDS: ReadonlySet<EmployeeBand> = new Set(['1-10', '11-50'])

// Common formats by company size: small firms often use first@, larger ones first.last@.
export function defaultOrder(band: EmployeeBand | undefined): EmailPattern[] {
  if (band && SMALL_BANDS.has(band)) return ['first', 'first.last', 'flast']
  if (band) return ['first.last', 'flast', 'first']
  return ['first.last', 'first', 'flast']
}

export interface CandidateRequest {
  firstName: string
  lastName: string
  domain: string
  guess: PatternGuess
  band: EmployeeBand | undefined
  // Address the company publishes for this person, if any; tried first.
  publishedAddress?: string | undefined
  // Other named people at the company: an address any of them could own is never tried for this person.
  colleagues: { firstName: string; lastName: string }[]
  // Addresses already known to be invalid.
  knownInvalid: ReadonlySet<string>
  max: number
}

function colleagueAddresses(request: CandidateRequest): Set<string> {
  const taken = new Set<string>()
  for (const colleague of request.colleagues) {
    const name = nameParts(colleague.firstName, colleague.lastName)
    if (name) for (const pattern of EMAIL_PATTERNS) taken.add(addressFor(pattern, name, request.domain))
  }
  return taken
}

// Addresses to verify for one person, most likely first, at most `max`.
export function candidateAddresses(request: CandidateRequest): string[] {
  const name = nameParts(request.firstName, request.lastName)
  if (!name) return []
  const order = request.guess.confident && request.guess.pattern
    ? [request.guess.pattern, ...defaultOrder(request.band).filter((pattern) => pattern !== request.guess.pattern)]
    : defaultOrder(request.band)
  const taken = colleagueAddresses(request)
  const generated = order.map((pattern) => addressFor(pattern, name, request.domain))
  const ordered = [...(request.publishedAddress ? [request.publishedAddress.toLowerCase()] : []), ...generated]
  const allowed = ordered.filter((address, index) => ordered.indexOf(address) === index && !request.knownInvalid.has(address))
  // A published address belongs to this person even if a colleague's name could render the same way.
  return allowed.filter((address) => address === request.publishedAddress?.toLowerCase() || !taken.has(address)).slice(0, request.max)
}
