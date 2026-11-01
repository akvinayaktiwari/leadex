import { describe, expect, it } from 'vitest'
import { legalNameKey } from '../src/lib/legal-names.js'

describe('legal name keys', () => {
  // protects=the same company written different ways gets one key (case, punctuation, accents, &, trailing legal forms);
  // fails_when="Acme Technologies Pvt. Ltd." and "ACME TECHNOLOGIES PRIVATE LIMITED" differ, or "Société Générale S.A." keeps
  // its accent or suffix;
  // no_claim=does not match abbreviations ("Intl" vs "International") or translations.
  it('normalizes spellings of the same name', () => {
    const same = ['Acme Technologies Pvt. Ltd.', 'ACME TECHNOLOGIES PRIVATE LIMITED', 'acme technologies pvt ltd', 'The Acme Technologies Ltd']
    expect(new Set(same.map(legalNameKey))).toEqual(new Set(['acme technologies']))
    expect(legalNameKey('Société Générale S.A.')).toBe('societe generale')
    expect(legalNameKey('Smith & Sons, Inc.')).toBe('smith and sons')
    expect(legalNameKey('Noon AD Holdings FZ-LLC')).toBe('noon ad holdings')
    expect(legalNameKey('Widgets L.L.C.')).toBe('widgets')
    expect(legalNameKey('A B Textiles')).toBe('a b textiles')
  })

  // protects=distinguishing words are kept and a name made only of legal forms gives no key;
  // fails_when="Acme Holdings" and "Acme" collide, or "Limited" alone matches every entity;
  // no_claim=n/a.
  it('keeps distinguishing words', () => {
    expect(legalNameKey('Acme Holdings Ltd')).not.toBe(legalNameKey('Acme Ltd'))
    expect(legalNameKey('Limited')).toBe('')
    expect(legalNameKey('Co.')).toBe('')
    expect(legalNameKey('  ')).toBe('')
  })
})
