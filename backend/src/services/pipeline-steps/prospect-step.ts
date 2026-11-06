// Lead build step 1 (#12): people at companies that match each picked segment, with a stored verified email. Only Leadex
// Data is searched; when it holds too few matches the build reports a shortfall instead of searching the web live.
import { LeadDataRuleError, PipelineError } from '../../lib/errors.js'
import type { CompanyRecord, IcpSegment, LeadBuildInput, LeadBuildState, LeadCandidate, LeadDataService, PersonRecord, PipelineStep, StepContext } from '../../types/index.js'
import { candidateCap, passesDeliveryRules, segmentTargets } from '../lead-build-rules.js'

// Spec: at most 2 people per company.
const PEOPLE_PER_COMPANY = 2
// Companies to look at per wanted candidate: many matching companies have no named person or no verified email yet.
const COMPANIES_PER_CANDIDATE = 3

export interface ProspectStepDeps {
  leadData: LeadDataService
}

interface SegmentResult {
  candidates: LeadCandidate[]
  companies: number
  // People with a verified email left out for a webmail address or a company name that doesn't fit its domain.
  mismatched: number
}

// Records whose every field is backed by a fact; the rest are skipped, never delivered.
async function keepDeliverable<T>(records: T[], load: (batch: T[]) => Promise<unknown[]>): Promise<T[]> {
  try {
    await load(records)
    return records
  } catch (error) {
    if (!(error instanceof LeadDataRuleError)) throw error
  }
  const kept: T[] = []
  for (const record of records) {
    try {
      await load([record])
      kept.push(record)
    } catch (error) {
      if (!(error instanceof LeadDataRuleError)) throw error
    }
  }
  return kept
}

// Up to 2 people per company, in search order, until the cap. The delivery rules run here so a candidate that would be
// dropped later never takes a place in the pool.
function pair(segment: IcpSegment, companies: CompanyRecord[], people: PersonRecord[], emails: Map<string, string>, cap: number): Omit<SegmentResult, 'companies'> {
  const candidates: LeadCandidate[] = []
  let mismatched = 0
  for (const company of companies) {
    const reachable = people.filter((person) => person.domain === company.domain && emails.has(person.personKey))
    const fitting = reachable.filter((person) => passesDeliveryRules(company, emails.get(person.personKey) ?? ''))
    mismatched += reachable.length - fitting.length
    for (const person of fitting.slice(0, PEOPLE_PER_COMPANY)) candidates.push({ segmentId: segment.segmentId, company, person, email: emails.get(person.personKey) ?? '' })
    if (candidates.length >= cap) break
  }
  return { candidates: candidates.slice(0, cap), mismatched }
}

async function prospectSegment(deps: ProspectStepDeps, input: LeadBuildInput, segment: IcpSegment, target: number): Promise<SegmentResult> {
  const cap = candidateCap(target)
  const found = await deps.leadData.findCompanies(segment.filters, cap * COMPANIES_PER_CANDIDATE)
  const companies = await keepDeliverable(found.filter((company) => company.domain !== input.profile.domain), (batch) => deps.leadData.loadDeliverableCompanies(batch))
  if (companies.length === 0) return { candidates: [], companies: 0, mismatched: 0 }
  const people = await deps.leadData.findPeople(companies.map((company) => company.domain), segment.buyerTitles, cap * PEOPLE_PER_COMPANY * 2)
  const deliverablePeople = await keepDeliverable(people, (batch) => deps.leadData.loadDeliverablePeople(batch))
  const emails = await deps.leadData.verifiedEmails(deliverablePeople.map((person) => person.personKey))
  return { ...pair(segment, companies, deliverablePeople, emails, cap), companies: companies.length }
}

async function execute(deps: ProspectStepDeps, input: LeadBuildInput | undefined, state: LeadBuildState, context: StepContext): Promise<void> {
  if (!input) throw new PipelineError('missing_build_input', 'This lead build has no segments to search')
  const targets = segmentTargets(input.segments, input.leadCount)
  const seen = new Set<string>()
  const all: LeadCandidate[] = []
  for (const segment of input.segments) {
    const result = await prospectSegment(deps, input, segment, targets.get(segment.segmentId) ?? 0)
    // A person who fits two segments is offered once, under the first.
    const fresh = result.candidates.filter((candidate) => !seen.has(candidate.person.personKey))
    for (const candidate of fresh) seen.add(candidate.person.personKey)
    all.push(...fresh)
    const mismatched = result.mismatched > 0 ? ` (${result.mismatched} left out for a webmail address or a name that doesn't fit the domain)` : ''
    await context.emit({ kind: 'agent_note', text: `${segment.name}: ${result.companies} matching companies, ${fresh.length} people with a verified email${mismatched}` })
  }
  state.candidates = all
}

export function createProspectStep(deps: ProspectStepDeps, input: LeadBuildInput | undefined, state: LeadBuildState): PipelineStep {
  return { id: 'prospect', label: 'Finding people at matching companies', execute: (context) => execute(deps, input, state, context) }
}
