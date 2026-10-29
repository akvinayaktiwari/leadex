import { describe, expect, it } from 'vitest'
import { buildSiteDigest, createProfileStep } from '../src/services/pipeline-steps/profile-step.js'
import type { AnalysisState, CrawledPage, StepContext, StepEmission } from '../src/types/index.js'
import { VALID_DRAFT, failed, fakeLlm, okJson } from './support/analysis-fakes.js'
import { sampleRun } from './support/in-memory-run-store.js'

const MODELS = { smart: 'model-smart', fast: 'model-fast' }

function page(path: string, text: string): CrawledPage {
  return { url: `https://acme.com${path}`, path, title: path, description: '', text }
}

function stateWithSite(pages: CrawledPage[] = [page('/', 'Invoicing for agencies')]): AnalysisState {
  return { site: { domain: 'acme.com', origin: 'https://acme.com', pages, blockedByRobots: 0, failedPages: 0 } }
}

async function run(responses: Parameters<typeof fakeLlm>[0], state = stateWithSite()) {
  const llm = fakeLlm(responses)
  const emitted: StepEmission[] = []
  const context: StepContext = { run: sampleRun(), emit: async (emission) => void emitted.push(emission) }
  await createProfileStep({ llm, models: MODELS }, state).execute(context)
  return { llm, emitted, state }
}

describe('profile step', () => {
  // protects=a valid model answer becomes the ProductProfile artifact with the crawled domain, using the fast model at low effort;
  // fails_when=the domain comes from the model, the artifact is not emitted, or the wrong model/effort is used;
  // no_claim=does not judge profile quality (eval harness, #13).
  it('emits a profile artifact from a valid answer', async () => {
    const { llm, emitted, state } = await run([okJson(VALID_DRAFT)])
    expect(state.profile).toEqual({ domain: 'acme.com', ...VALID_DRAFT })
    expect(emitted).toEqual([{ kind: 'artifact', step: 'profile', artifact: 'profile', data: state.profile }])
    expect(llm.requests[0]).toMatchObject({ model: 'model-fast', effort: 'low' })
    expect(llm.requests[0]?.turns[0]?.text).toContain('<page url="https://acme.com/"')
  })

  // protects=an invalid answer gets exactly one repair request that shows the model its output and the validation errors;
  // fails_when=invalid output is accepted, no repair is tried, or the repair lacks the error list;
  // no_claim=does not prove a real model fixes its output on repair.
  it('repairs an invalid answer once', async () => {
    const tooLong = { ...VALID_DRAFT, oneLiner: 'x'.repeat(200), servedMarkets: ['India'] }
    const { llm, state } = await run([okJson(tooLong), okJson(VALID_DRAFT)])
    expect(llm.requests).toHaveLength(2)
    const repair = llm.requests[1]?.turns ?? []
    expect(repair.map((turn) => turn.role)).toEqual(['user', 'assistant', 'user'])
    expect(repair[2]?.text).toContain('oneLiner')
    expect(repair[2]?.text).toContain('servedMarkets.0')
    expect(state.profile?.oneLiner).toBe(VALID_DRAFT.oneLiner)
  })

  // protects=a second invalid answer fails the step with profile_invalid, and a refusal fails at once with llm_refused;
  // fails_when=the step retries forever, accepts bad data, or retries a refusal;
  // no_claim=does not cover SDK-level HTTP retries.
  it('fails after a failed repair, and never retries a refusal', async () => {
    await expect(run([failed('not_json', 'oops'), failed('truncated', '{')])).rejects.toMatchObject({ code: 'profile_invalid' })
    const refused = run([failed('refusal')])
    await expect(refused).rejects.toMatchObject({ code: 'llm_refused' })
  })

  // protects=GLOBAL wins over country codes and duplicates are removed;
  // fails_when=servedMarkets is ['GLOBAL','US'] or repeats a country, which breaks competitor filtering in #5;
  // no_claim=does not validate that the codes are real countries.
  it('normalizes served markets', async () => {
    const { state } = await run([okJson({ ...VALID_DRAFT, servedMarkets: ['US', 'GLOBAL', 'US'] })])
    expect(state.profile?.servedMarkets).toEqual(['GLOBAL'])
    const local = await run([okJson({ ...VALID_DRAFT, servedMarkets: ['IN', 'AE', 'IN'] })])
    expect(local.state.profile?.servedMarkets).toEqual(['IN', 'AE'])
  })

  // protects=the prompt stays within its character budget, keeps page order, and caps any single page;
  // fails_when=one huge page crowds out pricing, or a large site sends 2 MB of text to the model;
  // no_claim=characters approximate tokens; real token counts are logged per call.
  it('keeps the prompt within budget and reports trimmed pages', async () => {
    const pages = [page('/', 'h'.repeat(40_000)), page('/pricing', 'p'.repeat(40_000)), page('/about', 'a'.repeat(40_000)), page('/x', 'x'.repeat(40_000)), page('/y', 'y'.repeat(40_000))]
    const digest = buildSiteDigest(pages)
    expect(digest.digest.length).toBeLessThanOrEqual(60_000)
    expect(digest.digest.indexOf('/pricing')).toBeGreaterThan(0)
    expect(digest.digest.match(/h{100,}/)?.[0].length).toBe(15_000)
    const { emitted } = await run([okJson(VALID_DRAFT)], stateWithSite(pages))
    expect(emitted[0]).toEqual({ kind: 'agent_note', text: `Summarizing from the ${digest.usedPages} most relevant of 5 pages` })
  })
})
