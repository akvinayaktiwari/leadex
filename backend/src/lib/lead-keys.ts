// Stable ids for Leadex Data rows, and the hashes stored in the suppression list.
import { createHash } from 'node:crypto'
import type { SuppressionKind } from '../types/index.js'

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function normalizeName(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')
}

export function normalizeLeadDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.$/, '').replace(/^www\./, '')
}

export function companyIdFor(domain: string): string {
  return sha256(normalizeLeadDomain(domain))
}

export function personKeyFor(firstName: string, lastName: string, domain: string): string {
  return sha256(`${normalizeName(firstName)}|${normalizeName(lastName)}|${normalizeLeadDomain(domain)}`)
}

// A person is suppressed by their person key; an email by its lowercased address; a domain by its normalized host.
export function suppressionHash(kind: SuppressionKind, value: string): string {
  if (kind === 'person') return sha256(`person|${value}`)
  if (kind === 'email') return sha256(`email|${value.trim().toLowerCase()}`)
  return sha256(`domain|${normalizeLeadDomain(value)}`)
}
