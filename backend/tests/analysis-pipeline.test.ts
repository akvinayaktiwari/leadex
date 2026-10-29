import { describe, expect, it } from 'vitest'
import { createRunEngineService } from '../src/services/run-engine-service.js'
import { createPipelineRegistry } from '../src/services/pipelines.js'
import type { RunEvent } from '../src/types/index.js'
import { VALID_DRAFT, fakeLlm, fakeSite, html, okJson } from './support/analysis-fakes.js'
import { manualClock, memoryEvents, memoryQueue, memoryRuns } from './support/in-memory-run-store.js'

const label = (event: RunEvent): string =>
  event.kind === 'step' ? `${event.step}:${event.state}` : event.kind === 'artifact' ? `artifact:${event.artifact}` : event.kind === 'end' ? `end:${event.status}` : 'note'

describe('analysis pipeline through the run engine', () => {
  // protects=a queued analysis run executes crawl then profile and its event log ends with the profile artifact and end:done;
  // fails_when=steps are missing or out of order, state doesn't flow from crawl to profile, or the run isn't marked done;
  // no_claim=uses fake site and LLM; competitors/segments arrive in #5.
  it('runs crawl and profile end to end', async () => {
    const runs = memoryRuns()
    const events = memoryEvents()
    const queue = memoryQueue()
    const clock = manualClock()
    const pipelines = createPipelineRegistry({
      siteFetch: fakeSite({ 'https://acme.com/': html('Acme', 'Invoicing software for agencies. '.repeat(20), ['/pricing']), 'https://acme.com/pricing': html('Pricing', 'From INR 499') }),
      llm: fakeLlm([okJson(VALID_DRAFT)]),
      models: { smart: 's', fast: 'f' },
      clock,
    })
    const engine = createRunEngineService({ runs, events, queue, pipelines, clock, newId: () => 'run_a' })
    await engine.createRun({ type: 'analysis', domain: 'acme.com' })
    await engine.executeRun({ runId: 'run_a', type: 'analysis' })

    expect(events.all('run_a').map(label)).toEqual(['crawl:started', 'note', 'crawl:completed', 'profile:started', 'artifact:profile', 'profile:completed', 'end:done'])
    expect(events.all('run_a').find((event) => event.kind === 'artifact')).toMatchObject({ data: { domain: 'acme.com', name: 'Acme Invoicing' } })
    expect((await runs.get('run_a'))?.status).toBe('done')
  })
})
