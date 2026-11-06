import { describe, expect, it } from 'vitest'
import { createLeadDataService } from '../src/services/lead-data-service.js'
import { createPipelineRegistry } from '../src/services/pipelines.js'
import { createRunEngineService } from '../src/services/run-engine-service.js'
import type { IcpSegment, LeadBuildInput, LlmJsonRequest, LlmJsonResponse, LlmRepository, ProductProfile, QualifiedLead, RunEvent } from '../src/types/index.js'
import { fakeSite } from './support/analysis-fakes.js'
import { manualClock, memoryEvents, memoryQueue, memoryRuns } from './support/in-memory-run-store.js'
import { companyWrite, memoryLeadData, personWrite } from './support/lead-data-fixtures.js'

const PROFILE: ProductProfile = {
  domain: 'seller.com', name: 'Seller', oneLiner: 'Ads for property developers', valueProps: ['Site visits'], category: 'marketing agency',
  pricingSignals: [], servedMarkets: ['US'], claims: [], crawledAt: '2026-11-01T00:00:00.000Z',
}
const SEGMENT: IcpSegment = {
  segmentId: 'devs', name: 'Property developers', useCase: 'Fill site visits', pain: 'Leads that never visit', criteria: ['Active project'],
  buyerTitles: ['Marketing'], sharePct: 100, filters: { industries: [], employeeMin: 0, employeeMax: 0, countries: ['US'], keywords: [], technologies: [] },
}
const USAGE = { model: 'fast', inputTokens: 10, outputTokens: 10, cacheReadTokens: 0 }

// Scores each company by name, as the model would, and keeps every prompt for inspection.
function scoringLlm(scores: Record<string, number>): LlmRepository & { prompts: string[] } {
  const llm = {
    prompts: [] as string[],
    async generateJson(request: LlmJsonRequest): Promise<LlmJsonResponse> {
      const prompt = request.turns.map((turn) => turn.text).join('\n')
      llm.prompts.push(prompt)
      const companies = JSON.parse(prompt.split('Companies: ')[1] ?? '[]') as { id: string; company: { name: string } }[]
      const value = { leads: companies.map((item) => ({ id: item.id, fitScore: scores[item.company.name] ?? 0, angle: `Fits ${item.company.name}`, skip: false })) }
      return { ok: true, value, rawText: JSON.stringify(value), usage: USAGE }
    },
  }
  return llm
}

async function seed() {
  const repository = memoryLeadData()
  const clock = manualClock()
  const leadData = createLeadDataService({ repository, clock })
  const person = async (domain: string, firstName: string, email: string, status = 'valid') => {
    const outcome = await leadData.savePerson(personWrite({ domain, firstName, lastName: 'Rao', title: 'Head of Marketing' }))
    repository.emails.set(outcome.entityId, { email, status })
  }
  await leadData.saveCompany(companyWrite({ domain: 'seller.com', name: 'Seller' }))
  await leadData.saveCompany(companyWrite({ domain: 'acmerealty.com', name: 'Acme Realty' }))
  await leadData.saveCompany(companyWrite({ domain: 'villahomes.com', name: 'Villa Homes' }))
  await leadData.saveCompany(companyWrite({ domain: 'brightbuild.com', name: 'Totally Different Name' }))
  await person('seller.com', 'Own', 'own@seller.com')
  await person('acmerealty.com', 'Asha', 'asha@acmerealty.com')
  await person('acmerealty.com', 'Ravi', 'ravi@gmail.com')
  await person('villahomes.com', 'Vik', 'vik@villahomes.com')
  await person('villahomes.com', 'Old', 'old@villahomes.com', 'invalid')
  await person('brightbuild.com', 'Bea', 'bea@brightbuild.com')
  return { leadData, clock }
}

async function runBuild(leadCount: number, scores: Record<string, number>) {
  const { leadData, clock } = await seed()
  const llm = scoringLlm(scores)
  const runs = memoryRuns()
  const events = memoryEvents()
  const pipelines = createPipelineRegistry({ siteFetch: fakeSite({}), llm, models: { smart: 's', fast: 'f' }, clock, leadData })
  const engine = createRunEngineService({ runs, events, queue: memoryQueue(), pipelines, clock, newId: () => 'run_b' })
  const input: LeadBuildInput = { profile: PROFILE, segments: [SEGMENT], leadCount }
  await engine.createRun({ type: 'lead_build', domain: 'seller.com', userId: 'user_1', leadBuild: input })
  await engine.executeRun({ runId: 'run_b', type: 'lead_build' })
  const all = events.all('run_b')
  const leads = all.flatMap((event: RunEvent) => (event.kind === 'artifact' && event.artifact === 'lead_batch' ? (event.data as { leads: QualifiedLead[] }).leads : []))
  const notes = all.flatMap((event) => (event.kind === 'agent_note' ? [event.text] : []))
  return { leads, notes, llm, run: await runs.get('run_b') }
}

describe('lead build (prospect + qualify)', () => {
  // protects=acceptance criterion 5 (shape): every delivered lead has a valid email at its company's domain, a name that fits
  // the domain and fit >= 60; the seller's own company, webmail addresses, non-valid emails and name/domain mismatches never
  // become leads; a shortfall is reported, not filled;
  // fails_when=a gmail address, an 'invalid' email, the seller itself, a mismatched company or a fit below 60 is delivered,
  // or fewer leads than asked arrive without a shortfall note;
  // no_claim=in-memory Leadex Data and a scripted model; real ranking quality is criterion 6 (hand check, #15).
  it('delivers only qualified leads and reports the shortfall', async () => {
    const { leads, notes, run } = await runBuild(3, { 'Acme Realty': 85, 'Villa Homes': 55, 'Totally Different Name': 99, Seller: 99 })
    expect(run?.status).toBe('done')
    expect(leads.map((lead) => lead.person.email)).toEqual(['asha@acmerealty.com'])
    expect(leads[0]).toMatchObject({ emailStatus: 'valid', fitScore: 85, angle: 'Fits Acme Realty', company: { domain: 'acmerealty.com', name: 'Acme Realty' } })
    expect(notes.at(-1)).toMatch(/Qualified 1 of the 3 leads asked for.*No live web search/)
    expect(notes[0]).toBe("Property developers: 3 matching companies, 2 people with a verified email (2 left out for a webmail address or a name that doesn't fit the domain)")
  })

  // protects=the model sees company fields and job titles only, never people's names or email addresses;
  // fails_when=a prompt contains a lead's email or surname;
  // no_claim=n/a.
  it('keeps personal data out of the model prompt', async () => {
    const { llm } = await runBuild(3, { 'Acme Realty': 85 })
    expect(llm.prompts.length).toBeGreaterThan(0)
    for (const prompt of llm.prompts) {
      expect(prompt).not.toMatch(/@acmerealty\.com|@villahomes\.com|Rao/)
      expect(prompt).toContain('Head of Marketing')
    }
  })

  // protects=no more leads than asked are delivered, best fit first;
  // fails_when=the build returns every qualified candidate instead of the requested count;
  // no_claim=n/a.
  it('stops at the requested count', async () => {
    const { leads, notes } = await runBuild(1, { 'Acme Realty': 70, 'Villa Homes': 90 })
    expect(leads.map((lead) => lead.company.name)).toEqual(['Villa Homes'])
    expect(notes.at(-1)).toMatch(/^Qualified 1 leads/)
  })
})
