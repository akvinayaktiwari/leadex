import { describe, expect, it } from 'vitest'
import { companyIdFor, personKeyFor } from '../src/lib/lead-keys.js'
import { createLeadDataService } from '../src/services/lead-data-service.js'
import { extractPeopleBatch, type PeopleExtractorDeps } from '../src/services/people-extractor-service.js'
import type {
  CompanyRecord, LlmJsonRequest, LlmJsonResponse, LlmRepository, PeopleCandidate, PeopleExtractionRepository, PeopleStatusEntry, PublishedEmailRow,
} from '../src/types/index.js'
import { failed, fakeSite, html, okJson } from './support/analysis-fakes.js'
import { manualClock } from './support/in-memory-run-store.js'
import { memoryLeadData } from './support/lead-data-fixtures.js'

const NOW = '2026-11-01T12:00:00.000Z'
const OPTIONS = { limit: 20, concurrency: 3, maxAttempts: 3, retryAfterDays: 7, refreshAfterDays: 90 }

const company = (domain: string): CompanyRecord => ({ companyId: companyIdFor(domain), domain, name: domain, keywords: [], country: 'IN', technologies: [], servedMarkets: [], updatedAt: NOW })

function memoryPeople(domains: string[]): PeopleExtractionRepository & { statuses: PeopleStatusEntry[]; emails: PublishedEmailRow[] } {
  const state = { statuses: [] as PeopleStatusEntry[], emails: [] as PublishedEmailRow[] }
  return {
    ...state,
    async nextCompanies(): Promise<PeopleCandidate[]> { return domains.map((domain) => ({ company: company(domain), attempts: domain === 'dead.com' ? 2 : 0 })) },
    async recordStatus(entries: PeopleStatusEntry[]) { state.statuses.push(...entries) },
    async insertPublishedEmails(rows: PublishedEmailRow[]) { state.emails.push(...rows) },
    async listPublishedEmails(domain: string) { return state.emails.filter((row) => row.domain === domain) },
  }
}

function llmByDomain(answers: Record<string, LlmJsonResponse[]>): LlmRepository & { askedFor: string[] } {
  const askedFor: string[] = []
  return {
    askedFor,
    async generateJson(request: LlmJsonRequest): Promise<LlmJsonResponse> {
      const domain = /^Company website: (\S+)/.exec(request.turns[0]?.text ?? '')?.[1] ?? ''
      askedFor.push(domain)
      const next = answers[domain]?.shift()
      if (!next) throw new Error(`no fake answer for ${domain}`)
      return next
    },
  }
}

const markup = JSON.stringify({ '@type': 'Organization', name: 'Markup Co', founder: { '@type': 'Person', name: 'Lata Menon', jobTitle: 'Founder' } })

function setup() {
  const repository = memoryLeadData()
  const clock = manualClock(NOW)
  const leadData = createLeadDataService({ repository, clock })
  const people = memoryPeople(['good.com', 'quiet.com', 'markup.com', 'dead.com', 'robots.com', 'broken.com'])
  const siteFetch = fakeSite({
    'https://good.com/': html('Good', 'Good Builders, Pune. Meet our team.', ['https://good.com/team', 'https://good.com/pricing']),
    'https://good.com/team': html('Team', 'Asha Rao Founder & CEO. Ravi Kumar Head of Marketing. Write to asha@good.com or info@good.com.'),
    'https://quiet.com/': html('Quiet', 'We sell bricks wholesale across Maharashtra at fair prices every day.'),
    'https://markup.com/': `<html><head><script type="application/ld+json">${markup}</script></head><body>Markup Co sells tiles in Kochi.</body></html>`,
    'https://robots.com/robots.txt': 'User-agent: *\nDisallow: /',
    'https://broken.com/': html('Broken', 'Our leadership team is here to help.'),
  })
  const llm = llmByDomain({
    'good.com': [okJson({ people: [
      { name: 'Asha Rao', title: 'Founder & CEO', isCurrentStaff: true, sourceUrl: 'https://good.com/team', quote: 'Asha Rao Founder & CEO' },
      { name: 'Ravi Kumar', title: 'Head of Marketing', isCurrentStaff: true, sourceUrl: 'https://good.com/team', quote: 'Ravi Kumar Head of Marketing' },
    ] })],
    'broken.com': [failed('not_json'), failed('not_json')],
  })
  const deps: PeopleExtractorDeps = { people, leadData, siteFetch, llm, model: 'fast', clock, prices: { inputUsdPerMillion: 1, outputUsdPerMillion: 5 } }
  return { deps, people, repository, llm, leadData }
}

const outcomes = (statuses: PeopleStatusEntry[]): Record<string, string> =>
  Object.fromEntries(statuses.map((s) => [s.domain, `${s.status}${s.reason ? `:${s.reason}` : ''}/${s.peopleFound}/${s.attempts}`]))

describe('people extractor', () => {
  // protects=each company ends in one recorded outcome; sourced people and published addresses are stored; pages without any
  // role words skip the model call; markup people are stored without a model call; failures count attempts;
  // fails_when=quiet sites still cost a model call, a dead site's attempts don't grow, or people are stored without facts;
  // no_claim=fake sites and model; precision on real sites needs the labelled set and an API key.
  it('extracts people per company and records outcomes', async () => {
    const { deps, people, repository, llm } = setup()
    const summary = await extractPeopleBatch(deps, OPTIONS)
    expect(outcomes(people.statuses)).toEqual({
      'good.com': 'done/2/0', 'quiet.com': 'skipped:no_people_found/0/0', 'markup.com': 'done/1/0',
      'dead.com': 'failed:unreachable/0/3', 'robots.com': 'skipped:robots_disallowed/0/0', 'broken.com': 'failed:llm_failed/0/1',
    })
    expect(llm.askedFor.sort()).toEqual(['broken.com', 'broken.com', 'good.com'])
    expect(repository.people.map((person) => `${person.firstName} ${person.lastName}@${person.domain}`).sort()).toEqual(['Asha Rao@good.com', 'Lata Menon@markup.com', 'Ravi Kumar@good.com'])
    expect(people.emails.map((row) => `${row.email}:${row.personKey === personKeyFor('Asha', 'Rao', 'good.com') ? 'asha' : row.personKey || '-'}`).sort()).toEqual(['asha@good.com:asha', 'info@good.com:-'])
    expect(summary).toMatchObject({ attempted: 6, done: 2, peopleSaved: 3, emailsStored: 2 })
    expect(summary.costUsd).toBeCloseTo((3 * 1000 * 1 + 3 * 200 * 5) / 1_000_000)
  })

  // protects=a suppressed person is not stored and neither is their address; a suppressed address is never stored;
  // fails_when=a removal request still lets the person's email into published_emails;
  // no_claim=n/a.
  it('keeps suppressed people and addresses out', async () => {
    const { deps, people, leadData, repository } = setup()
    await leadData.suppress('person', personKeyFor('Asha', 'Rao', 'good.com'), 'removal_request')
    await leadData.suppress('email', 'info@good.com', 'opt_out')
    await extractPeopleBatch(deps, OPTIONS)
    expect(repository.people.some((person) => person.firstName === 'Asha')).toBe(false)
    expect(people.emails.filter((row) => row.domain === 'good.com')).toEqual([])
  })
})
