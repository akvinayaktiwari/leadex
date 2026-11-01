// Email address formats a company may use, and how a person's name renders in each.

export const EMAIL_PATTERNS = [
  'first.last', 'first', 'flast', 'firstlast', 'f.last', 'first_last', 'first-last', 'last', 'last.first', 'lastf', 'firstl', 'first.l', 'lastfirst',
] as const

export type EmailPattern = (typeof EMAIL_PATTERNS)[number]

export interface NameParts {
  first: string
  last: string
}

// Lowercase ASCII letters only: accents stripped, spaces/apostrophes/hyphens removed ("Ana de la Cruz" → last "delacruz").
function asciiLetters(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^a-z]/g, '')
}

export function nameParts(firstName: string, lastName: string): NameParts | undefined {
  const first = asciiLetters(firstName.split(/\s+/)[0] ?? '')
  const last = asciiLetters(lastName)
  return first.length >= 1 && last.length >= 1 ? { first, last } : undefined
}

export function localPart(pattern: EmailPattern, name: NameParts): string {
  const { first, last } = name
  const f = first[0] ?? ''
  const l = last[0] ?? ''
  const forms: Record<EmailPattern, string> = {
    'first.last': `${first}.${last}`, first, flast: `${f}${last}`, firstlast: `${first}${last}`, 'f.last': `${f}.${last}`,
    first_last: `${first}_${last}`, 'first-last': `${first}-${last}`, last, 'last.first': `${last}.${first}`, lastf: `${last}${f}`,
    firstl: `${first}${l}`, 'first.l': `${first}.${l}`, lastfirst: `${last}${first}`,
  }
  return forms[pattern]
}

export function addressFor(pattern: EmailPattern, name: NameParts, domain: string): string {
  return `${localPart(pattern, name)}@${domain}`
}

// Every pattern that renders this person's name as the given local part (several can coincide, e.g. a one-letter first name).
export function patternsMatching(local: string, name: NameParts): EmailPattern[] {
  const target = local.toLowerCase()
  return EMAIL_PATTERNS.filter((pattern) => localPart(pattern, name) === target)
}
