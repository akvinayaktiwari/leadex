// Pure rules for Leadex Data: which fields need provenance, and whether a record may be stored or delivered.
import { isAllowedCountry } from '../lib/countries.js'
import { LeadDataRuleError } from '../lib/errors.js'

type FieldValue = string | number | boolean | string[] | undefined

// A field makes a claim when it carries information: non-empty text or list, a number, or `true`.
function isPopulated(value: FieldValue): boolean {
  if (value === undefined || value === false) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  return true
}

// Fields of a record that make a claim and therefore need a fact. Derived ids and timestamps are excluded.
export function populatedFields(record: Record<string, FieldValue>, derived: readonly string[]): string[] {
  return Object.entries(record)
    .filter(([field, value]) => !derived.includes(field) && isPopulated(value))
    .map(([field]) => field)
    .sort()
}

export function missingProvenance(fields: string[], factFields: Iterable<string>): string[] {
  const backed = new Set(factFields)
  return fields.filter((field) => !backed.has(field))
}

export function assertProvenance(entity: string, fields: string[], factFields: Iterable<string>): void {
  const missing = missingProvenance(fields, factFields)
  if (missing.length > 0) {
    throw new LeadDataRuleError('missing_provenance', `${entity} has fields without a source: ${missing.join(', ')}`)
  }
}

export function assertAllowedCountry(entity: string, country: string): void {
  if (!isAllowedCountry(country)) {
    throw new LeadDataRuleError('blocked_country', `${entity} is in a blocked or unknown country: "${country}"`)
  }
}

export function assertPresent(entity: string, values: Record<string, string>): void {
  const empty = Object.entries(values).filter(([, value]) => value.trim().length === 0).map(([field]) => field)
  if (empty.length > 0) throw new LeadDataRuleError('invalid_record', `${entity} is missing required fields: ${empty.join(', ')}`)
}
