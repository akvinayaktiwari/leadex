import { describe, expect, it } from 'vitest'
import { createCompetitorsStep } from '../src/services/pipeline-steps/competitors-step.js'
import type { AnalysisState, Competitor, ProductProfile, StepContext, StepEmission } from '../src/types/index.js'
import { fakeLlm, fakeSite, html, okJson } from './support/analysis-fakes.js'
import { manualClock, sampleRun } from './support/in-memory-run-store.js'

const MODELS = { smart: 'model-smart', fast: 'model-fast' }
const FILLER = ' We plan campaigns, write ad creatives, manage budgets and report weekly on leads, site visits and bookings for every project we run. Our team works with developers, brokers and channel partners from launch to sell-out.'

const QDNCO: ProductProfile = {
  domain: 'qdnco.com', name: 'QD & Co.', oneLiner: 'Real estate performance marketing in Bangalore and Dubai', valueProps: ['a', 'b', 'c'],
  category: 'real estate marketing agency', pricingSignals: [], servedMarkets: ['IN', 'AE'],
}

const proposal = (domain: string, hqCountry: string, name = domain) => ({ domain, name, reason: 'Real estate ads agency', hqCountry })

// Homepages for the qdnco.com fixture: the shape of what Explee suggested (2026-10-20) plus Indian and Dubai agencies.
const SITES: Record<string, string> = {
  'https://xionmedia.in/': html('Xion Media', `Real estate digital marketing.${FILLER}`),
  'https://iengage.digital/': html('iEngage', `Property marketing for developers across India.${FILLER}`),
  'https://wafirealty.com/': html('Wafi', `Real estate marketing agency in Dubai. Call +971 4 555 0101.${FILLER}`),
  'https://brokerbiz.com.br/': html('BrokerBiz', `Marketing imobiliário para corretores.${FILLER}`),
  'https://creart.cl/': html('Creart', `Agencia de marketing inmobiliario.${FILLER}`),
  'https://saai-sa.com/': html('Saai', `Real estate marketing. Riyadh office +966 11 555 0000, Jeddah +966 12 555 0000.${FILLER}`),
  'https://topleadsdigital.com/': html('Top Leads', `Leads for property developers that convert.${FILLER}`),
  'https://parked-agency.com/': html('Parked', `This domain is for sale. Buy this domain today.${FILLER}`),
}

async function run(profile: ProductProfile, proposals: object[]) {
  const llm = fakeLlm([okJson({ competitors: proposals })])
  const state: AnalysisState = { profile }
  const emitted: StepEmission[] = []
  const context: StepContext = { run: sampleRun(), emit: async (emission) => void emitted.push(emission) }
  await createCompetitorsStep({ siteFetch: fakeSite(SITES), llm, models: MODELS, clock: manualClock() }, state).execute(context)
  return { state, emitted, llm }
}

describe('competitors step', () => {
  // protects=#5 done-when: for qdnco.com (serves IN, AE) no kept competitor is outside IN/AE, whatever the model suggests; the
  // model's country is trusted only when the competitor's own site supports it; own domain, platforms, duplicates, parked and
  // dead sites are dropped; each kept competitor is emitted with how its country was established;
  // fails_when=a Brazilian, Chilean or Saudi agency is kept (Explee's failure), a model-only "IN" claim is kept, or the business
  // itself appears as its own competitor;
  // no_claim=fake sites and model; real suggestion quality is measured with the eval fixtures (#15).
  it('keeps only competitors whose own site places them in the served markets', async () => {
    const { state, emitted, llm } = await run(QDNCO, [
      proposal('xionmedia.in', 'IN'), proposal('www.iengage.digital', 'IN'), proposal('wafirealty.com', 'AE'),
      proposal('brokerbiz.com.br', 'IN'), proposal('creart.cl', 'CL'), proposal('saai-sa.com', 'AE'), proposal('topleadsdigital.com', 'IN'),
      proposal('parked-agency.com', 'IN'), proposal('dead-agency.in', 'IN'), proposal('qdnco.com', 'IN'), proposal('facebook.com', 'US'), proposal('xionmedia.in', 'IN'),
    ])
    const kept = (state.competitors ?? []).map((c: Competitor) => `${c.domain}:${c.country}:${c.countrySource}`)
    expect(kept).toEqual(['xionmedia.in:IN:cctld', 'iengage.digital:IN:text', 'wafirealty.com:AE:phone'])
    expect((state.competitors ?? []).every((c) => ['IN', 'AE'].includes(c.country))).toBe(true)
    expect(emitted.filter((e) => e.kind === 'artifact').map((e) => e.kind === 'artifact' && (e.data as Competitor).domain)).toEqual(['xionmedia.in', 'iengage.digital', 'wafirealty.com'])
    const note = emitted.find((e) => e.kind === 'agent_note')
    expect(note?.kind === 'agent_note' && note.text).toBe('Kept 3 of 9 suggested competitors (left out 3 outside your markets, 1 with no location on their site, 1 parked domains, 1 unreachable)')
    expect(llm.requests[0]).toMatchObject({ model: 'model-fast' })
  })

  // protects=a business serving the whole world keeps competitors from any country with site evidence, at most 10;
  // fails_when=a GLOBAL business loses its foreign competitors, or more than 10 are returned;
  // no_claim=n/a.
  it('keeps any located competitor for a global business, at most 10', async () => {
    const global = { ...QDNCO, servedMarkets: ['GLOBAL'] }
    const many = Array.from({ length: 12 }, (_, i) => proposal(`agency${i}.in`, 'IN'))
    const sites = Object.fromEntries(many.map((p) => [`https://${p.domain}/`, html(p.domain, `Agency.${FILLER}`)]))
    Object.assign(SITES, sites)
    const { state } = await run(global, [proposal('brokerbiz.com.br', 'BR'), ...many])
    expect(state.competitors?.length).toBe(10)
    expect(state.competitors?.[0]?.country).toBe('BR')
  })
})
