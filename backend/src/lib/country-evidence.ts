// Where a website says it is: from its own markup, phone numbers, domain ending, or text naming a country.
// Used to keep competitors in the markets the user's business serves.
import { normalizeCountry } from './countries.js'

export type CountrySource = 'structured_data' | 'phone' | 'cctld' | 'text'

export interface CountryEvidence {
  country: string
  source: CountrySource
}

// ccTLDs used as generic brand endings (.io, .ai, .co …): not evidence of location.
const GENERIC_CCTLDS = new Set(['io', 'ai', 'co', 'me', 'tv', 'cc', 'ws', 'fm', 'gg', 'ly', 'so', 'to', 'la', 'sh', 'ac', 'app', 'is', 'it', 'am', 'im', 'vc', 'nu', 'xyz'])

// International dialling codes, longest first when matched. +1 (US/Canada) is ambiguous and left out.
const DIAL_CODES: [string, string][] = [
  ['971', 'AE'], ['966', 'SA'], ['974', 'QA'], ['965', 'KW'], ['968', 'OM'], ['973', 'BH'], ['880', 'BD'], ['977', 'NP'], ['852', 'HK'],
  ['234', 'NG'], ['254', 'KE'], ['91', 'IN'], ['44', 'GB'], ['61', 'AU'], ['65', 'SG'], ['55', 'BR'], ['56', 'CL'], ['84', 'VN'],
  ['49', 'DE'], ['33', 'FR'], ['34', 'ES'], ['39', 'IT'], ['31', 'NL'], ['27', 'ZA'], ['60', 'MY'], ['62', 'ID'], ['63', 'PH'],
  ['81', 'JP'], ['82', 'KR'], ['86', 'CN'], ['20', 'EG'], ['92', 'PK'], ['94', 'LK'], ['52', 'MX'], ['54', 'AR'], ['57', 'CO'],
  ['64', 'NZ'], ['90', 'TR'], ['48', 'PL'], ['41', 'CH'], ['46', 'SE'], ['47', 'NO'], ['45', 'DK'], ['353', 'IE'], ['351', 'PT'],
]

// Extra names people use for a country, beyond its English name.
const ALIASES: Record<string, string[]> = {
  AE: ['uae', 'dubai', 'abu dhabi', 'sharjah'], US: ['usa', 'u.s.'], GB: ['uk', 'london'], IN: ['bengaluru', 'bangalore', 'mumbai', 'delhi', 'pune', 'hyderabad', 'chennai'],
  SA: ['ksa', 'riyadh', 'jeddah'], SG: ['singapore'],
}

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' })

export function countryFromDomain(domain: string): string | undefined {
  const tld = domain.toLowerCase().split('.').pop() ?? ''
  if (tld.length !== 2 || GENERIC_CCTLDS.has(tld)) return undefined
  return normalizeCountry(tld === 'uk' ? 'GB' : tld)
}

// The country most phone numbers on the page dial into; undefined when none or tied.
export function countryFromPhones(text: string): string | undefined {
  const counts = new Map<string, number>()
  for (const match of text.matchAll(/\+\s?(\d{1,3})[\s().-]*\d/g)) {
    const digits = match[1] ?? ''
    const code = DIAL_CODES.find(([prefix]) => digits.startsWith(prefix) && prefix.length <= digits.length)
    if (code) counts.set(code[1], (counts.get(code[1]) ?? 0) + 1)
  }
  const ranked = [...counts].sort((a, b) => b[1] - a[1])
  return ranked[0] && ranked[0][1] > (ranked[1]?.[1] ?? 0) ? ranked[0][0] : undefined
}

// Whether the text names the country (English name or a common alias) as a whole word.
export function textNamesCountry(text: string, country: string): boolean {
  const lower = ` ${text.toLowerCase().replace(/\s+/g, ' ')} `
  const names = [regionNames.of(country) ?? '', ...(ALIASES[country] ?? [])].map((name) => name.toLowerCase()).filter(Boolean)
  return names.some((name) => new RegExp(`[^a-z]${name.replace(/[.]/g, '\\.')}[^a-z]`).test(lower))
}

// Strongest evidence first. `claimed` (the model's guess) only counts when the site's own text names that country.
export function resolveCountry(input: { structured?: string | undefined; text: string; domain: string; claimed?: string | undefined }): CountryEvidence | undefined {
  const structured = input.structured ? normalizeCountry(input.structured) : undefined
  if (structured) return { country: structured, source: 'structured_data' }
  const phone = countryFromPhones(input.text)
  if (phone) return { country: phone, source: 'phone' }
  const cctld = countryFromDomain(input.domain)
  if (cctld) return { country: cctld, source: 'cctld' }
  const claimed = input.claimed ? normalizeCountry(input.claimed) : undefined
  return claimed && textNamesCountry(input.text, claimed) ? { country: claimed, source: 'text' } : undefined
}
