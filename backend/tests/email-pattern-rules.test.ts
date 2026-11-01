import { describe, expect, it } from 'vitest'
import { candidateAddresses, inferPattern, type CandidateRequest, type PatternEvidence } from '../src/services/email-pattern-rules.js'

const linked = (email: string, firstName: string, lastName: string): PatternEvidence => ({ email, strength: 'published_linked', firstName, lastName })
const unlinked = (email: string): PatternEvidence => ({ email, strength: 'published_unlinked' })

describe('email pattern inference', () => {
  // protects=a format is "known" only with strong evidence that clearly beats the alternatives;
  // fails_when=one unlinked "jane.doe" is treated as certain, two conflicting addresses pick a winner, or a lone "kmorrow"
  // teaches a format;
  // no_claim=companies that mix formats across staff will look uncertain, by design.
  it('infers a format only when evidence is clear', () => {
    expect(inferPattern([linked('asha.rao@acme.com', 'Asha', 'Rao')])).toMatchObject({ pattern: 'first.last', confident: true })
    expect(inferPattern([unlinked('jane.doe@acme.com')])).toMatchObject({ pattern: 'first.last', confident: false, weight: 0.5 })
    expect(inferPattern([unlinked('kmorrow@acme.com')])).toMatchObject({ confident: false, weight: 0 })
    expect(inferPattern([linked('asha.rao@acme.com', 'Asha', 'Rao'), linked('rkumar@acme.com', 'Ravi', 'Kumar')]).confident).toBe(false)
    const strong = inferPattern([linked('asha.rao@acme.com', 'Asha', 'Rao'), linked('ravi.kumar@acme.com', 'Ravi', 'Kumar'), linked('pshah@acme.com', 'Priya', 'Shah')])
    expect(strong).toMatchObject({ pattern: 'first.last', confident: true, weight: 2 })
  })
})

describe('candidate addresses', () => {
  const base: CandidateRequest = {
    firstName: 'Asha', lastName: 'Rao', domain: 'acme.com', guess: { weight: 0, confident: false, weights: {} },
    band: undefined, colleagues: [], knownInvalid: new Set(), max: 3,
  }

  // protects=a published address comes first, then the company's known format, then size-based defaults, deduplicated;
  // fails_when=a guessed address is tried before the one the company published, or the known format is not first;
  // no_claim=n/a.
  it('orders candidates by likelihood', () => {
    expect(candidateAddresses(base)).toEqual(['asha.rao@acme.com', 'asha@acme.com', 'arao@acme.com'])
    expect(candidateAddresses({ ...base, band: '1-10' })).toEqual(['asha@acme.com', 'asha.rao@acme.com', 'arao@acme.com'])
    expect(candidateAddresses({ ...base, guess: { pattern: 'flast', weight: 2, confident: true, weights: {} }, max: 2 })).toEqual(['arao@acme.com', 'asha.rao@acme.com'])
    expect(candidateAddresses({ ...base, publishedAddress: 'Asha.Rao@acme.com', max: 2 })).toEqual(['asha.rao@acme.com', 'asha@acme.com'])
  })

  // protects=an address a colleague's name could produce is never tried (it might be their mailbox), known-invalid addresses are
  // skipped, and a published address still wins;
  // fails_when="arao@" is verified for Asha while Anil Rao works there too, or a bounced address is retried;
  // no_claim=only colleagues already in Leadex Data are known.
  it('skips addresses a colleague could own', () => {
    const withAnil = { ...base, guess: { pattern: 'flast' as const, weight: 2, confident: true, weights: {} }, colleagues: [{ firstName: 'Anil', lastName: 'Rao' }] }
    expect(candidateAddresses(withAnil)).toEqual(['asha.rao@acme.com', 'asha@acme.com'])
    expect(candidateAddresses({ ...withAnil, knownInvalid: new Set(['asha.rao@acme.com']) })).toEqual(['asha@acme.com'])
    expect(candidateAddresses({ ...withAnil, publishedAddress: 'arao@acme.com' })[0]).toBe('arao@acme.com')
  })
})
