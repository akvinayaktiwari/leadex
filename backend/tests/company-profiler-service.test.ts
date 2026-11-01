import { describe, expect, it } from 'vitest'
import { PLATFORM_DOMAINS } from '../src/config/platform-domains.js'
import { createLeadDataService } from '../src/services/lead-data-service.js'
import { profileBatch, type CompanyProfilerDeps } from '../src/services/company-profiler-service.js'
import type {
  CrawlStatusEntry, CrawlStatusRepository, LeadDataService, LlmJsonRequest, LlmJsonResponse, LlmRepository, ProfileCandidate, ProfileSelection,
} from '../src/types/index.js'
import { failed, fakeSite, html, okJson } from './support/analysis-fakes.js'
import { manualClock } from './support/in-memory-run-store.js'
import { memoryLeadData } from './support/lead-data-fixtures.js'
import { profileDraft } from './support/profile-fixtures.js'

const OPTIONS = { limit: 50, concurrency: 4, maxAttempts: 3, retryAfterDays: 7, refreshAfterDays: 90 }
const ADDRESS = 'Visit us at 12 CMH Road, Indiranagar, Bengaluru 560038, India.'

function memoryStatuses(domains: string[]): CrawlStatusRepository & { recorded: CrawlStatusEntry[]; selection?: ProfileSelection } {
  const state: { recorded: CrawlStatusEntry[]; selection?: ProfileSelection } = { recorded: [] }
  return Object.assign(state, {
    async nextToProfile(selection: ProfileSelection): Promise<ProfileCandidate[]> {
      state.selection = selection
      return domains.map((domain, i) => ({ domain, harmonicRank: i + 1, attempts: domain === 'dead.com' ? 1 : 0 }))
    },
    async recordStatus(entries: CrawlStatusEntry[]) { state.recorded.push(...entries) },
  })
}

// Answers by the domain named in the prompt, so concurrent domains never get each other's draft.
function llmByDomain(answers: Record<string, LlmJsonResponse[]>): LlmRepository {
  return {
    async generateJson(request: LlmJsonRequest): Promise<LlmJsonResponse> {
      const domain = /^Website: (\S+)/.exec(request.turns[0]?.text ?? '')?.[1] ?? ''
      const next = answers[domain]?.shift()
      if (!next) throw new Error(`no fake answer for ${domain}`)
      return next
    },
  }
}

function draftFor(domain: string, overrides = {}): object {
  const home = `https://${domain}/`
  return profileDraft({
    name: { value: domain, sourceUrl: home }, description: { value: 'Payroll software', sourceUrl: home },
    industry: { value: 'software', sourceUrl: home }, keywords: { value: ['payroll'], sourceUrl: home },
    servedMarkets: { value: ['IN'], sourceUrl: home },
    location: { country: 'IN', region: '', city: 'Bengaluru', sourceUrl: home, quote: 'Indiranagar, Bengaluru 560038' },
    ...overrides,
  })
}

// Enough text to pass the profiler's 200-character readability floor, like a real homepage.
const FILLER = ' We help teams run payroll, track leave and file statutory returns on time, with support by phone and email every working day.'
const homepage = (domain: string, body: string): Record<string, string> => ({ [`https://${domain}/`]: html(domain, `${body}${FILLER}${FILLER}`) })

function setup(leadData?: LeadDataService) {
  const repository = memoryLeadData()
  const clock = manualClock('2026-11-01T12:00:00.000Z')
  const domains = ['good.com', 'blog.com', 'dead.com', 'robots.com', 'moved.com', 'invented.com', 'broken-llm.com']
  const statuses = memoryStatuses(domains)
  const siteFetch = fakeSite({
    ...homepage('good.com', `Payroll for small businesses. ${ADDRESS}`),
    ...homepage('blog.com', `My travel diary. ${ADDRESS}`),
    'https://robots.com/robots.txt': 'User-agent: *\nDisallow: /',
    ...homepage('robots.com', 'secret'),
    'https://other-company.com/': html('Other', `A different business. ${ADDRESS}${FILLER}${FILLER}`),
    ...homepage('invented.com', 'Payroll software for everyone, no address listed anywhere on this page at all.'),
    ...homepage('broken-llm.com', `Payroll. ${ADDRESS}`),
  }, { 'https://moved.com/': 'https://other-company.com/', 'https://www.moved.com/': 'https://other-company.com/' })
  const llm = llmByDomain({
    'good.com': [okJson(draftFor('good.com'))],
    'blog.com': [okJson(draftFor('blog.com', { isBusiness: false, notBusinessReason: 'personal blog' }))],
    'invented.com': [okJson(draftFor('invented.com', { location: { country: 'IN', region: '', city: 'Mumbai', sourceUrl: 'https://invented.com/', quote: 'Bandra West, Mumbai 400050' } }))],
    'broken-llm.com': [failed('not_json'), failed('not_json')],
  })
  const deps: CompanyProfilerDeps = {
    statuses, siteFetch, llm, model: 'fast', clock, prices: { inputUsdPerMillion: 1, outputUsdPerMillion: 5 },
    leadData: leadData ?? createLeadDataService({ repository, clock }),
  }
  return { deps, statuses, repository }
}

const outcomes = (recorded: CrawlStatusEntry[]): Record<string, string> =>
  Object.fromEntries(recorded.map((entry) => [entry.domain, `${entry.status}${entry.reason ? `:${entry.reason}` : ''}/${entry.attempts}`]))

describe('company profiler', () => {
  // protects=each domain ends in exactly one recorded outcome with the right reason, only the real business is stored,
  // failures count attempts up and other outcomes reset them;
  // fails_when=a blog, a redirect to another company, a robots-blocked site or an invented address is stored,
  // a dead site's attempts don't grow, or a model failure crashes the batch;
  // no_claim=fake sites and model; cost per real company is measured with the sample command, not here.
  it('profiles a batch and records an outcome per domain', async () => {
    const { deps, statuses, repository } = setup()
    const summary = await profileBatch(deps, OPTIONS)
    expect(outcomes(statuses.recorded)).toEqual({
      'good.com': 'profiled/0', 'blog.com': 'skipped:not_a_business/0', 'dead.com': 'failed:unreachable/2',
      'robots.com': 'skipped:robots_disallowed/0', 'moved.com': 'skipped:redirects_elsewhere/0',
      'invented.com': 'skipped:unknown_country/0', 'broken-llm.com': 'failed:llm_failed/1',
    })
    expect(repository.companies.map((company) => company.domain)).toEqual(['good.com'])
    expect(summary).toMatchObject({ attempted: 7, profiled: 1, skipped: { not_a_business: 1, robots_disallowed: 1, redirects_elsewhere: 1, unknown_country: 1 }, failed: { unreachable: 1, llm_failed: 1 } })
  })

  // protects=token usage from every model call (including repairs) is totalled, and cost uses the configured prices;
  // fails_when=repair calls are not counted, or cost is computed without prices;
  // no_claim=cache-read tokens are reported but not priced.
  it('totals token usage and cost', async () => {
    const { deps } = setup()
    const summary = await profileBatch(deps, OPTIONS)
    // 3 successful drafts + 2 failed attempts for broken-llm.com, 1000 in / 200 out each (fake usage).
    expect(summary.usage).toEqual({ inputTokens: 5000, outputTokens: 1000, cacheReadTokens: 0 })
    expect(summary.costUsd).toBeCloseTo((5000 * 1 + 1000 * 5) / 1_000_000)
  })

  // protects=an unexpected error on one domain (e.g. the database is down) is recorded as failed:error and the batch continues;
  // fails_when=one exception aborts the whole batch or leaves the domain without a status;
  // no_claim=does not cover the status write itself failing (the ingest job reports that run as failed).
  it('isolates unexpected errors', async () => {
    const exploding: LeadDataService = { ...createLeadDataService({ repository: memoryLeadData(), clock: manualClock() }), saveCompany: async () => { throw new Error('ClickHouse is down') } }
    const { deps, statuses } = setup(exploding)
    await profileBatch(deps, OPTIONS)
    expect(outcomes(statuses.recorded)['good.com']).toBe('failed:error/1')
    expect(statuses.recorded).toHaveLength(7)
  })

  // protects=selection excludes platform domains and uses the retry/refresh windows from the options;
  // fails_when=googleapis.com is selected or failed domains are retried the next day;
  // no_claim=the SQL that applies these is tested in clickhouse-crawl-status.test.ts.
  it('asks for the right selection', async () => {
    const { deps, statuses } = setup()
    await profileBatch(deps, OPTIONS)
    expect(statuses.selection).toEqual({
      limit: 50, excludedDomains: [...PLATFORM_DOMAINS], maxAttempts: 3,
      retryFailedBefore: '2026-10-25T12:00:00.000Z', refreshProfiledBefore: '2026-08-03T12:00:00.000Z',
    })
  })
})
