// Email finder (#24): for people without a verified address, learn each company's format, try the most likely
// addresses through the paid verifier, and keep only what it confirms. Deliverability first: only 'valid' is delivered.
import { BLOCKED_COUNTRIES } from '../lib/countries.js'
import { patternsMatching, nameParts } from '../lib/email-patterns.js'
import { VerifierOutOfCredits, VerifierRateLimited } from '../lib/errors.js'
import { logError, logInfo } from '../lib/logger.js'
import type {
  Clock, DomainMail, DomainPatternRow, EmailBatchSummary, EmailCheck, EmailFinderRepository, EmailResult, EmailVerifier, LeadDataService,
  MailDnsRepository, PersonNeedingEmail, PersonRecord, VerificationResult, VerificationStatus,
} from '../types/index.js'
import { candidateAddresses, inferPattern, type PatternEvidence, type PatternGuess } from './email-pattern-rules.js'

const DAY_MS = 86_400_000

export interface EmailFinderDeps {
  finder: EmailFinderRepository
  dns: MailDnsRepository
  verifier: EmailVerifier
  leadData: LeadDataService
  clock: Clock
  sleep: (ms: number) => Promise<void>
}

export interface EmailBatchOptions {
  limit: number
  maxChecksPerPerson: number
  retryUnknownAfterDays: number
  recheckAfterDays: number
  rateLimitBackoffMs: number
}

interface DomainContext {
  mail: DomainMail
  guess: PatternGuess
  evidence: PatternEvidence[]
  colleagues: PersonRecord[]
  invalid: Set<string>
  // Set once any address at the domain comes back catch_all: further checks there would be paid for nothing.
  acceptsAll: boolean
}

class BatchStop extends Error {}

function patternOf(person: PersonRecord, email: string): string {
  const name = nameParts(person.firstName, person.lastName)
  return (name && patternsMatching(email.split('@')[0] ?? '', name)[0]) ?? ''
}

// A DNS failure (e.g. a timeout) is not proof the domain has no mail: its people are skipped this run, not marked invalid.
async function lookupOrSkip(deps: EmailFinderDeps, domain: string): Promise<DomainMail | undefined> {
  try {
    return await deps.dns.lookup(domain)
  } catch (error) {
    logError('MX lookup failed; skipping domain this run', error, { domain })
    return undefined
  }
}

async function loadDomains(deps: EmailFinderDeps, domains: string[]): Promise<Map<string, DomainContext>> {
  const [evidenceRows, colleagues, invalid] = await Promise.all([deps.finder.evidence(domains), deps.finder.colleagues(domains), deps.finder.invalidAddresses(domains)])
  const contexts = new Map<string, DomainContext>()
  for (const domain of domains) {
    const evidence = evidenceRows.filter((row) => row.domain === domain).map((row) => ({ email: row.email, strength: row.strength, firstName: row.firstName, lastName: row.lastName }))
    const mail = await lookupOrSkip(deps, domain)
    if (!mail) continue
    contexts.set(domain, { mail, guess: inferPattern(evidence), evidence, colleagues: colleagues.filter((person) => person.domain === domain), invalid, acceptsAll: false })
  }
  return contexts
}

function publishedAddressFor(person: PersonRecord, context: DomainContext): string | undefined {
  return context.evidence.find((item) => item.strength === 'published_linked' && item.firstName === person.firstName && item.lastName === person.lastName)?.email
}

async function verifyOnce(deps: EmailFinderDeps, email: string, options: EmailBatchOptions): Promise<VerificationResult> {
  try {
    return await deps.verifier.verify(email)
  } catch (error) {
    if (!(error instanceof VerifierRateLimited)) throw error
    await deps.sleep(options.rateLimitBackoffMs)
    return deps.verifier.verify(email)
  }
}

interface PersonOutcome {
  result?: EmailResult | undefined
  checks: EmailCheck[]
  noMailDomain: boolean
}

function resultFor(deps: EmailFinderDeps, person: PersonRecord, email: string, status: VerificationStatus): EmailResult {
  return { personKey: person.personKey, email, pattern: patternOf(person, email), status, checkedBy: deps.verifier.name, checkedAt: deps.clock.now().toISOString() }
}

async function candidatesFor(deps: EmailFinderDeps, entry: PersonNeedingEmail, context: DomainContext, options: EmailBatchOptions): Promise<string[]> {
  const { person } = entry
  const colleagues = context.colleagues.filter((other) => other.personKey !== person.personKey).map((other) => ({ firstName: other.firstName, lastName: other.lastName }))
  const candidates = candidateAddresses({
    firstName: person.firstName, lastName: person.lastName, domain: person.domain, guess: context.guess, band: entry.employeeBand,
    publishedAddress: publishedAddressFor(person, context), colleagues, knownInvalid: context.invalid, max: options.maxChecksPerPerson,
  })
  const allowed = await deps.leadData.allowedEmails(candidates)
  return candidates.filter((email) => allowed.has(email))
}

async function verifyCandidates(deps: EmailFinderDeps, person: PersonRecord, candidates: string[], context: DomainContext, options: EmailBatchOptions): Promise<PersonOutcome> {
  const checks: EmailCheck[] = []
  let fallback: EmailResult | undefined
  for (const email of candidates) {
    const verification = await verifyOnce(deps, email, options)
    checks.push({ personKey: person.personKey, domain: person.domain, email, status: verification.status, reason: verification.reason, checkedBy: deps.verifier.name, checkedAt: deps.clock.now().toISOString() })
    if (verification.status === 'valid') return { result: resultFor(deps, person, email, 'valid'), checks, noMailDomain: false }
    if (verification.status === 'catch_all') {
      context.acceptsAll = true
      return { result: resultFor(deps, person, email, 'catch_all'), checks, noMailDomain: false }
    }
    if (verification.status === 'invalid') context.invalid.add(email)
    else fallback ??= resultFor(deps, person, email, 'unknown')
  }
  return { result: fallback ?? (candidates[0] ? resultFor(deps, person, candidates[0], 'invalid') : undefined), checks, noMailDomain: false }
}

async function findForPerson(deps: EmailFinderDeps, entry: PersonNeedingEmail, context: DomainContext, options: EmailBatchOptions): Promise<PersonOutcome> {
  const candidates = await candidatesFor(deps, entry, context, options)
  if (context.mail.mxHost === '') return { result: candidates[0] ? resultFor(deps, entry.person, candidates[0], 'invalid') : undefined, checks: [], noMailDomain: true }
  // A catch-all domain accepts any address, so a paid check proves nothing: keep the best guess as catch_all.
  if (context.acceptsAll) return { result: candidates[0] ? resultFor(deps, entry.person, candidates[0], 'catch_all') : undefined, checks: [], noMailDomain: false }
  return verifyCandidates(deps, entry.person, candidates, context, options)
}

function tally(summary: EmailBatchSummary, outcome: PersonOutcome): void {
  summary.checks += outcome.checks.length
  if (outcome.noMailDomain) summary.noMailDomain += 1
  const status = outcome.result?.status
  if (status === 'valid') summary.valid += 1
  else if (status === 'catch_all') summary.catchAll += 1
  else if (status === 'unknown') summary.unknown += 1
  else if (status === 'invalid' && !outcome.noMailDomain) summary.invalid += 1
}

async function persist(deps: EmailFinderDeps, outcome: PersonOutcome): Promise<void> {
  await deps.finder.insertChecks(outcome.checks)
  if (outcome.result) await deps.finder.insertResults([outcome.result])
}

function domainPatternRows(contexts: Map<string, DomainContext>, checkedAt: string): DomainPatternRow[] {
  return [...contexts.values()].map((context) => ({
    domain: context.mail.domain, pattern: context.guess.confident ? context.guess.pattern ?? '' : '', evidenceCount: context.evidence.length,
    mxHost: context.mail.mxHost, acceptsAll: context.acceptsAll, checkedAt,
  }))
}

async function processPeople(deps: EmailFinderDeps, people: PersonNeedingEmail[], contexts: Map<string, DomainContext>, options: EmailBatchOptions, summary: EmailBatchSummary): Promise<void> {
  for (const entry of people) {
    const context = contexts.get(entry.person.domain)
    if (!context) continue
    try {
      const outcome = await findForPerson(deps, entry, context, options)
      await persist(deps, outcome)
      tally(summary, outcome)
    } catch (error) {
      if (error instanceof VerifierOutOfCredits || error instanceof VerifierRateLimited) throw new BatchStop(error.message)
      throw error
    }
  }
}

export async function findEmailsBatch(deps: EmailFinderDeps, options: EmailBatchOptions): Promise<EmailBatchSummary> {
  const now = deps.clock.now().getTime()
  const people = await deps.finder.peopleNeedingEmail({
    limit: options.limit, excludedCountries: [...BLOCKED_COUNTRIES],
    retryUnknownBefore: new Date(now - options.retryUnknownAfterDays * DAY_MS).toISOString(), recheckBefore: new Date(now - options.recheckAfterDays * DAY_MS).toISOString(),
  })
  const summary: EmailBatchSummary = { people: people.length, valid: 0, catchAll: 0, invalid: 0, unknown: 0, noMailDomain: 0, checks: 0 }
  const contexts = await loadDomains(deps, [...new Set(people.map((entry) => entry.person.domain))])
  try {
    await processPeople(deps, people, contexts, options, summary)
  } catch (error) {
    if (!(error instanceof BatchStop)) throw error
    summary.stoppedReason = error.message
    logError('email batch stopped early', error, { checks: summary.checks })
  }
  await deps.finder.insertDomainPatterns(domainPatternRows(contexts, deps.clock.now().toISOString()))
  logInfo('email batch finished', { ...summary, stoppedReason: summary.stoppedReason ?? null })
  return summary
}
