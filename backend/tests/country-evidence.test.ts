import { describe, expect, it } from 'vitest'
import { countryFromDomain, countryFromPhones, resolveCountry, textNamesCountry } from '../src/lib/country-evidence.js'

describe('country evidence', () => {
  // protects=country domain endings count (including second-level ones), generic brand endings do not;
  // fails_when=".io" is read as the British Indian Ocean Territory or ".com.br" is missed;
  // no_claim=a .com tells nothing.
  it('reads country domain endings', () => {
    expect([countryFromDomain('agency.com.br'), countryFromDomain('studio.in'), countryFromDomain('ads.co.uk'), countryFromDomain('tool.io'), countryFromDomain('acme.com')])
      .toEqual(['BR', 'IN', 'GB', undefined, undefined])
  })

  // protects=phone numbers point to the country most of them dial into; +1 and ties give no answer;
  // fails_when=a single foreign office number outweighs three local ones, or +971 is read as +97;
  // no_claim=numbers written without "+" are ignored.
  it('reads phone country codes', () => {
    expect(countryFromPhones('Call +91 98765 43210 or +91-80-4000-1234; Dubai office +971 4 123 4567')).toBe('IN')
    expect(countryFromPhones('Tel: +971 (4) 555 0101')).toBe('AE')
    expect(countryFromPhones('+1 (415) 555-0100')).toBeUndefined()
    expect(countryFromPhones('+91 1 and +971 2')).toBeUndefined()
  })

  // protects=country names and common aliases match as whole words;
  // fails_when="India" matches inside "Indiana", or "UAE"/"Dubai" is not recognised for AE;
  // no_claim=English names only.
  it('finds country names in text', () => {
    expect(textNamesCountry('Offices in Dubai and Mumbai', 'AE')).toBe(true)
    expect(textNamesCountry('Serving clients across India', 'IN')).toBe(true)
    expect(textNamesCountry('Based in Indianapolis, Indiana', 'IN')).toBe(false)
  })

  // protects=evidence order: site markup, then phones, then domain ending, then the model's claim only if the site names it;
  // fails_when=the model's guess overrides a .com.br domain, or a claim with no support on the site is accepted;
  // no_claim=n/a.
  it('resolves the strongest evidence', () => {
    expect(resolveCountry({ structured: 'in', text: '+55 11 5555 0000', domain: 'x.com.br' })).toEqual({ country: 'IN', source: 'structured_data' })
    expect(resolveCountry({ text: 'Fale conosco +55 11 5555 0000', domain: 'agencia.com', claimed: 'IN' })).toEqual({ country: 'BR', source: 'phone' })
    expect(resolveCountry({ text: 'Marketing imobiliário', domain: 'agencia.com.br', claimed: 'IN' })).toEqual({ country: 'BR', source: 'cctld' })
    expect(resolveCountry({ text: 'Real estate ads across India', domain: 'propads.com', claimed: 'IN' })).toEqual({ country: 'IN', source: 'text' })
    expect(resolveCountry({ text: 'Real estate ads that convert', domain: 'propads.com', claimed: 'IN' })).toBeUndefined()
  })
})
