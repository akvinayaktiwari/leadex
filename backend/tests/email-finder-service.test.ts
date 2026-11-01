import { describe, expect, it } from 'vitest'
import { VerifierOutOfCredits, VerifierRateLimited } from '../src/lib/errors.js'
import { personKeyFor } from '../src/lib/lead-keys.js'
import { findEmailsBatch, type EmailFinderDeps } from '../src/services/email-finder-service.js'
import { createLeadDataService } from '../src/services/lead-data-service.js'
import type {
  DomainMail, DomainPatternRow, EmailCheck, EmailEvidenceRow, EmailFinderRepository, EmailResult, EmailVerifier, PersonNeedingEmail, PersonRecord, VerificationStatus,
} from '../src/types/index.js'
import { manualClock } from './support/in-memory-run-store.js'
import { memoryLeadData } from './support/lead-data-fixtures.js'

const NOW = '2026-11-01T12:00:00.000Z'
const OPTIONS = { limit: 50, maxChecksPerPerson: 2, retryUnknownAfterDays: 7, recheckAfterDays: 90, rateLimitBackoffMs: 10 }

const person = (first: string, last: string, domain: string): PersonRecord => ({
  personKey: personKeyFor(first, last, domain), domain, firstName: first, lastName: last, title: 'Owner', seniority: 'owner', country: 'IN', isOfficer: false, updatedAt: NOW,
})

function memoryFinder(people: PersonNeedingEmail[], evidence: EmailEvidenceRow[] = []): EmailFinderRepository & { checks: EmailCheck[]; results: EmailResult[]; patterns: DomainPatternRow[] } {
  const state = { checks: [] as EmailCheck[], results: [] as EmailResult[], patterns: [] as DomainPatternRow[] }
  return {
    ...state,
    async peopleNeedingEmail() { return people },
    async evidence(domains: string[]) { return evidence.filter((row) => domains.includes(row.domain)) },
    async colleagues(domains: string[]) { return people.map((entry) => entry.person).filter((p) => domains.includes(p.domain)) },
    async invalidAddresses() { return new Set(['asha@bounced.com']) },
    async insertChecks(rows: EmailCheck[]) { state.checks.push(...rows) },
    async insertResults(rows: EmailResult[]) { state.results.push(...rows) },
    async insertDomainPatterns(rows: DomainPatternRow[]) { state.patterns.push(...rows) },
  }
}

// Answers by address; anything not listed is invalid. Throws for scripted errors.
function fakeVerifier(answers: Record<string, VerificationStatus | Error | Error[]>): EmailVerifier & { calls: string[] } {
  const calls: string[] = []
  return {
    name: 'fake', calls,
    async verify(email: string) {
      calls.push(email)
      let answer = answers[email] ?? 'invalid'
      if (Array.isArray(answer)) answer = answer.shift() ?? 'valid'
      if (answer instanceof Error) throw answer
      return { email, status: answer, reason: `fake:${answer}` }
    },
  }
}

const dnsOf = (mail: Record<string, string | Error>) => ({
  async lookup(domain: string): Promise<DomainMail> {
    const mx = mail[domain] ?? 'mx.example.net'
    if (mx instanceof Error) throw mx
    return { domain, mxHost: mx, provider: 'other' }
  },
})

function deps(finder: EmailFinderRepository, verifier: EmailVerifier, mail: Record<string, string | Error> = {}): EmailFinderDeps {
  const leadData = createLeadDataService({ repository: memoryLeadData(), clock: manualClock(NOW) })
  return { finder, verifier, dns: dnsOf(mail), leadData, clock: manualClock(NOW), sleep: async () => {} }
}

const statusOf = (finder: { results: EmailResult[] }) => Object.fromEntries(finder.results.map((r) => [r.email, r.status]))
const entry = (p: PersonRecord, band?: PersonNeedingEmail['employeeBand']): PersonNeedingEmail => ({ person: p, employeeBand: band })

describe('email finder', () => {
  // protects=the person's published address is tried first, a known company format is used next, defaults follow, and the
  // search stops at the first valid address (one paid check when the first guess is right);
  // fails_when=a guessed address is paid for before the published one, or checking continues after a valid result;
  // no_claim=fake verifier.
  it('tries the likeliest address first and stops at valid', async () => {
    const asha = person('Asha', 'Rao', 'acme.com')
    const ravi = person('Ravi', 'Kumar', 'acme.com')
    const finder = memoryFinder([entry(asha), entry(ravi)], [{ domain: 'acme.com', email: 'arao@acme.com', strength: 'published_linked', firstName: 'Asha', lastName: 'Rao' }])
    const verifier = fakeVerifier({ 'arao@acme.com': 'valid', 'rkumar@acme.com': 'invalid', 'ravi.kumar@acme.com': 'valid' })
    const summary = await findEmailsBatch(deps(finder, verifier), OPTIONS)
    expect(verifier.calls).toEqual(['arao@acme.com', 'rkumar@acme.com', 'ravi.kumar@acme.com'])
    expect(statusOf(finder)).toEqual({ 'arao@acme.com': 'valid', 'ravi.kumar@acme.com': 'valid' })
    expect(finder.results.find((r) => r.email === 'ravi.kumar@acme.com')?.pattern).toBe('first.last')
    expect(summary).toMatchObject({ people: 2, valid: 2, checks: 3 })
    expect(finder.checks.map((c) => `${c.email}:${c.status}`)).toContain('rkumar@acme.com:invalid')
  })

  // protects=no paid checks for a domain without mail, nor for other people at a domain found to accept everything; those are
  // recorded as invalid / catch_all, never delivered;
  // fails_when=credits are spent on a dead domain or on every person at a catch-all company;
  // no_claim=n/a.
  it('saves checks on dead and catch-all domains', async () => {
    const people = [entry(person('Asha', 'Rao', 'dead.com')), entry(person('Mira', 'Das', 'catchall.com')), entry(person('Sam', 'Lee', 'catchall.com'))]
    const finder = memoryFinder(people)
    const verifier = fakeVerifier({ 'mira.das@catchall.com': 'catch_all' })
    const summary = await findEmailsBatch(deps(finder, verifier, { 'dead.com': '' }), OPTIONS)
    expect(verifier.calls).toEqual(['mira.das@catchall.com'])
    expect(statusOf(finder)).toEqual({ 'asha.rao@dead.com': 'invalid', 'mira.das@catchall.com': 'catch_all', 'sam.lee@catchall.com': 'catch_all' })
    expect(summary).toMatchObject({ noMailDomain: 1, catchAll: 2, checks: 1 })
    expect(finder.patterns.find((row) => row.domain === 'catchall.com')?.acceptsAll).toBe(true)
  })

  // protects=at most maxChecksPerPerson paid checks, known-invalid and suppressed addresses are never checked, and a person
  // with no valid answer is stored as unknown (retried later) or invalid (not retried);
  // fails_when=a third guess is paid for, a bounced or suppressed address is checked again;
  // no_claim=n/a.
  it('respects the check limit, invalid history and suppression', async () => {
    const asha = person('Asha', 'Rao', 'bounced.com')
    const finder = memoryFinder([entry(asha, '1-10')])
    const d = deps(finder, fakeVerifier({ 'asha.rao@bounced.com': 'unknown' }))
    await d.leadData.suppress('email', 'arao@bounced.com', 'removal_request')
    await findEmailsBatch(d, OPTIONS)
    expect((d.verifier as ReturnType<typeof fakeVerifier>).calls).toEqual(['asha.rao@bounced.com'])
    expect(statusOf(finder)).toEqual({ 'asha.rao@bounced.com': 'unknown' })
  })

  // protects=running out of credits stops the batch cleanly (work so far kept, domain patterns saved, reason reported), a rate
  // limit is retried once after a pause, and a DNS failure skips only that domain;
  // fails_when=a 402 marks every remaining person invalid, a single 429 aborts the batch, or one DNS timeout fails everything;
  // no_claim=n/a.
  it('handles credits, rate limits and DNS failures', async () => {
    const people = [entry(person('Asha', 'Rao', 'acme.com')), entry(person('Tim', 'Ng', 'flaky.com')), entry(person('Ravi', 'Kumar', 'acme.com')), entry(person('Ola', 'Berg', 'acme.com'))]
    const finder = memoryFinder(people)
    const verifier = fakeVerifier({
      // Rate limited once, then valid on the retry.
      'asha.rao@acme.com': [new VerifierRateLimited('fake')],
      'ravi.kumar@acme.com': new VerifierOutOfCredits('fake'),
    })
    const summary = await findEmailsBatch(deps(finder, verifier, { 'flaky.com': Object.assign(new Error('ETIMEOUT'), { code: 'ETIMEOUT' }) }), OPTIONS)
    expect(verifier.calls).toEqual(['asha.rao@acme.com', 'asha.rao@acme.com', 'ravi.kumar@acme.com'])
    expect(statusOf(finder)).toEqual({ 'asha.rao@acme.com': 'valid' })
    expect(summary.stoppedReason).toMatch(/credits/)
    expect(finder.patterns.map((row) => row.domain)).toEqual(['acme.com'])
  })
})
