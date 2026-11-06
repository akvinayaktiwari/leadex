import { describe, expect, it } from 'vitest'
import { candidateCap, emailMatchesDomain, nameMatchesDomain, rankLeads, segmentTargets } from '../src/services/lead-build-rules.js'
import type { IcpSegment, QualifiedLead } from '../src/types/index.js'

const segment = (segmentId: string, sharePct: number): IcpSegment => ({
  segmentId, name: segmentId, useCase: '', pain: '', criteria: [], buyerTitles: [], sharePct,
  filters: { industries: [], employeeMin: 0, employeeMax: 0, countries: [], keywords: [], technologies: [] },
})

const lead = (leadId: string, fitScore: number, country: string): QualifiedLead => ({
  leadId, segmentId: 's', fitScore, angle: '', emailStatus: 'valid',
  company: { domain: `${leadId}.com`, name: leadId, country }, person: { firstName: 'A', lastName: 'B', title: 'CEO', email: `a@${leadId}.com` },
})

describe('lead build rules', () => {
  // protects=the requested count is split across picked segments by share, sums exactly to the request, and every picked
  // segment gets at least one lead when there are enough to go round; candidates get 30% headroom;
  // fails_when=rounding loses or adds leads, a small segment gets none, or the candidate pool is unbounded;
  // no_claim=n/a.
  it('splits the lead count by share', () => {
    expect([...segmentTargets([segment('a', 35), segment('b', 25), segment('c', 25), segment('d', 15)], 50).values()]).toEqual([18, 13, 12, 7])
    expect([...segmentTargets([segment('a', 95), segment('b', 5)], 3).values()]).toEqual([2, 1])
    expect([...segmentTargets([segment('a', 60), segment('b', 40)], 1).values()].reduce((x, y) => x + y)).toBe(1)
    expect(candidateCap(50)).toBe(65)
  })

  // protects=spec qualify rule: the email must be at the company's own domain;
  // fails_when=a gmail.com address or a look-alike domain (acme.com.evil.io) passes as acme.com;
  // no_claim=n/a.
  it('requires the email at the company domain', () => {
    expect(emailMatchesDomain('Riya@Acme.com', 'acme.com')).toBe(true)
    expect(emailMatchesDomain('riya@mail.acme.com', 'www.acme.com')).toBe(true)
    expect(emailMatchesDomain('riya@gmail.com', 'acme.com')).toBe(false)
    expect(emailMatchesDomain('riya@acme.com.evil.io', 'acme.com')).toBe(false)
    expect(emailMatchesDomain('riya@notacme.com', 'acme.com')).toBe(false)
  })

  // protects=spec qualify rule: the company name and its domain must belong together (normalized tokens, '&' as 'n',
  // initials), while legal words alone never match;
  // fails_when=a real pairing like "QD & Co." / qdnco.com is dropped, or "Acme Ltd" passes on unrelated-ltd.com;
  // no_claim=brand names unrelated to the legal name (e.g. a holding company) are dropped by design.
  it('checks that the name fits the domain', () => {
    expect(nameMatchesDomain('QD & Co.', 'qdnco.com')).toBe(true)
    expect(nameMatchesDomain('Xion Media', 'xionmedia.in')).toBe(true)
    expect(nameMatchesDomain('International Business Machines', 'ibm.com')).toBe(true)
    expect(nameMatchesDomain('Société Générale', 'societegenerale.com')).toBe(true)
    expect(nameMatchesDomain('Acme Ltd', 'unrelated-ltd.com')).toBe(false)
    expect(nameMatchesDomain('Billbook', 'zoho.com')).toBe(false)
    expect(nameMatchesDomain('', 'acme.com')).toBe(false)
  })

  // protects=leads are ordered by fit score, and on equal scores the segment's first target country comes first;
  // fails_when=a lower score outranks a higher one, or ties ignore the target region;
  // no_claim=n/a.
  it('ranks by fit, then target country', () => {
    const ranked = rankLeads([lead('us', 80, 'US'), lead('in', 80, 'IN'), lead('top', 95, 'US')], ['IN', 'US'])
    expect(ranked.map((item) => item.leadId)).toEqual(['top', 'in', 'us'])
  })
})
