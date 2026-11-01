import { describe, expect, it } from 'vitest'
import { addressFor, nameParts, patternsMatching } from '../src/lib/email-patterns.js'

describe('email patterns', () => {
  // protects=names render into each format with accents stripped and multi-word surnames joined;
  // fails_when="José Núñez" keeps accents, "Ana de la Cruz" becomes "ana.de", or an empty name yields an address;
  // no_claim=does not handle nicknames ("Bob" for Robert) or family-name-first conventions.
  it('renders names into formats', () => {
    const jose = nameParts('José', 'Núñez')!
    expect([addressFor('first.last', jose, 'acme.com'), addressFor('flast', jose, 'acme.com'), addressFor('first', jose, 'acme.com')])
      .toEqual(['jose.nunez@acme.com', 'jnunez@acme.com', 'jose@acme.com'])
    expect(addressFor('first.last', nameParts('Ana', 'de la Cruz')!, 'acme.com')).toBe('ana.delacruz@acme.com')
    expect(nameParts('Mary Ann', "O'Brien")).toEqual({ first: 'mary', last: 'obrien' })
    expect(nameParts('', 'Rao')).toBeUndefined()
  })

  // protects=a known address is explained by exactly the formats that produce it, so evidence is counted honestly;
  // fails_when="jane.doe" is credited to "last.first", or "jdoe" to "first.last";
  // no_claim=n/a.
  it('finds the formats that explain an address', () => {
    const jane = nameParts('Jane', 'Doe')!
    expect(patternsMatching('jane.doe', jane)).toEqual(['first.last'])
    expect(patternsMatching('JDoe', jane)).toEqual(['flast'])
    expect(patternsMatching('jane', jane)).toEqual(['first'])
    expect(patternsMatching('someone', jane)).toEqual([])
    // A one-letter first name makes "flast" and "firstlast" the same address: both are credited.
    expect(patternsMatching('jdoe', nameParts('J', 'Doe')!)).toEqual(['flast', 'firstlast'])
  })
})
