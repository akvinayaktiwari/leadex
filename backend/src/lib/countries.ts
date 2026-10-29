// v1 neither stores nor returns people or companies located in the EU, EEA or UK (spec: Compliance).

const EU_MEMBERS = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
]
const EEA_NON_EU = ['IS', 'LI', 'NO']
const UNITED_KINGDOM = ['GB']
// Non-ISO codes some sources use for Greece and the UK; blocked too so an alias can't slip through.
const ALIASES = ['EL', 'UK']

export const BLOCKED_COUNTRIES: readonly string[] = [...EU_MEMBERS, ...EEA_NON_EU, ...UNITED_KINGDOM, ...ALIASES]

const BLOCKED = new Set(BLOCKED_COUNTRIES)

export function normalizeCountry(code: string): string | undefined {
  const upper = code.trim().toUpperCase()
  return /^[A-Z]{2}$/.test(upper) ? upper : undefined
}

// Unknown or malformed countries are not allowed: we can't prove the record is outside the EU/EEA/UK.
export function isAllowedCountry(code: string): boolean {
  const country = normalizeCountry(code)
  return country !== undefined && !BLOCKED.has(country)
}
