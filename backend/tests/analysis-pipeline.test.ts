import { describe, expect, it } from 'vitest'
import { createRunEngineService } from '../src/services/run-engine-service.js'
import { createPipelineRegistry } from '../src/services/pipelines.js'
import type { RunEvent } from '../src/types/index.js'
import { VALID_DRAFT, fakeLlm, fakeSite, html, okJson } from './support/analysis-fakes.js'
import { manualClock, memoryEvents, memoryQueue, memoryRuns } from './support/in-memory-run-store.js'

const label = (event: RunEvent): string =>
  event.kind === 'step' ? `${event.step}:${event.state}` : event.kind === 'artifact' ? `artifact:${event.artifact}` : event.kind === 'end' ? `end:${event.status}` : 'note'

describe('analysis pipeline through the run engine', () => {
  // protects=a queued analysis run executes crawl, profile, competitors and segments in order, state flows between them (the
  // competitors step reads the profile's served markets), and the log ends with segment artifacts and end:done;
  // fails_when=a step is missing or out of order, competitors ignore the profile, or the run isn't marked done;
  // no_claim=uses fake site and LLM.
  it('runs the full analysis end to end', async () => {
    const runs = memoryRuns()
    const events = memoryEvents()
    const queue = memoryQueue()
    const clock = manualClock()
    const pipelines = createPipelineRegistry({
      siteFetch: fakeSite({
        'https://acme.com/': html('Acme', 'Invoicing software for agencies. '.repeat(20), ['/pricing']), 'https://acme.com/pricing': html('Pricing', 'From INR 499'),
        'https://billbook.in/': html('Billbook', 'GST invoicing for small businesses. '.repeat(10)),
        'https://invoiceit.com.br/': html('InvoiceIt', 'Faturamento para agências. '.repeat(10)),
      }),
      llm: fakeLlm([
        okJson(VALID_DRAFT),
        okJson({ competitors: [
          { domain: 'billbook.in', name: 'Billbook', reason: 'GST invoicing', hqCountry: 'IN' },
          { domain: 'invoiceit.com.br', name: 'InvoiceIt', reason: 'Invoicing', hqCountry: 'IN' },
        ] }),
        okJson({ segments: ['Design agencies', 'Marketing agencies', 'IT consultancies', 'Freelance studios'].map((name, i) => ({
          name, useCase: 'Send invoices', pain: 'Late payments', criteria: ['Bills clients monthly', 'Under 50 staff'], buyerTitles: ['Founder', 'Finance Manager'],
          industries: ['marketing_advertising'], employeeMin: 2, employeeMax: 50, countries: ['IN'], keywords: ['agency'], technologies: [], sharePct: 40 - i * 10,
        })) }),
      ]),
      models: { smart: 's', fast: 'f' },
      clock,
    })
    const engine = createRunEngineService({ runs, events, queue, pipelines, clock, newId: () => 'run_a' })
    await engine.createRun({ type: 'analysis', domain: 'acme.com' })
    await engine.executeRun({ runId: 'run_a', type: 'analysis' })

    expect(events.all('run_a').map(label)).toEqual([
      'crawl:started', 'note', 'crawl:completed', 'profile:started', 'artifact:profile', 'profile:completed',
      'competitors:started', 'artifact:competitor', 'note', 'competitors:completed',
      'segments:started', 'artifact:segment', 'artifact:segment', 'artifact:segment', 'artifact:segment', 'segments:completed', 'end:done',
    ])
    const artifacts = events.all('run_a').filter((event) => event.kind === 'artifact')
    expect(artifacts[0]).toMatchObject({ data: { domain: 'acme.com', name: 'Acme Invoicing' } })
    expect(artifacts[1]).toMatchObject({ data: { domain: 'billbook.in', country: 'IN' } })
    expect((await runs.get('run_a'))?.status).toBe('done')
  })
})
