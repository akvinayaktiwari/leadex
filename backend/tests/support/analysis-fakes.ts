import type { FetchRequest, FetchResult, LlmJsonRequest, LlmJsonResponse, LlmRepository, SiteFetchRepository } from '../../src/types/index.js'

export interface FakeSite extends SiteFetchRepository {
  requested: string[]
}

// Serves HTML (or robots text) by exact URL; redirects map a URL to the final URL it lands on.
export function fakeSite(pages: Record<string, string>, redirects: Record<string, string> = {}): FakeSite {
  const site: FakeSite = {
    requested: [],
    async fetchText(request: FetchRequest): Promise<FetchResult> {
      site.requested.push(request.url)
      const finalUrl = redirects[request.url] ?? request.url
      const body = pages[finalUrl]
      return body === undefined ? { ok: false, reason: 'http_error', status: 404 } : { ok: true, finalUrl, status: 200, body }
    },
  }
  return site
}

export function html(title: string, body: string, links: string[] = []): string {
  const nav = links.map((href) => `<a href="${href}">${href}</a>`).join('')
  return `<html><head><title>${title}</title></head><body><nav>${nav}</nav><main>${body}</main></body></html>`
}

export interface FakeLlm extends LlmRepository {
  requests: LlmJsonRequest[]
}

const USAGE = { model: 'claude-opus-5-5', inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0 }

export function okJson(value: unknown): LlmJsonResponse {
  return { ok: true, value, rawText: JSON.stringify(value), usage: USAGE }
}

export function failed(reason: 'refusal' | 'truncated' | 'not_json', rawText = ''): LlmJsonResponse {
  return { ok: false, reason, rawText, usage: USAGE }
}

export function fakeLlm(responses: LlmJsonResponse[]): FakeLlm {
  const llm: FakeLlm = {
    requests: [],
    async generateJson(request: LlmJsonRequest): Promise<LlmJsonResponse> {
      llm.requests.push(request)
      const next = responses.shift()
      if (!next) throw new Error('fake LLM has no more responses')
      return next
    },
  }
  return llm
}

const HOME = 'https://acme.com/'

export const VALID_DRAFT = {
  name: 'Acme Invoicing',
  oneLiner: { text: 'Invoicing software for small agencies in India', sourceUrl: HOME },
  valueProps: [
    { text: 'Send GST invoices in seconds', sourceUrl: HOME },
    { text: 'Automatic payment reminders', sourceUrl: HOME },
    { text: 'UPI and card payments', sourceUrl: 'https://acme.com/not-crawled' },
  ],
  category: { text: 'invoicing software for small businesses', sourceUrl: HOME },
  pricingSignals: [{ text: 'free trial', sourceUrl: 'https://acme.com/pricing' }, { text: 'from INR 499 per month', sourceUrl: 'https://acme.com/pricing' }],
  servedMarkets: ['IN'],
}

// A site, two competitors and four segments: everything one analysis of acme.com needs, with call counters.
export function acmeAnalysisFakes(): { siteFetch: FakeSite; llm: FakeLlm } {
  return {
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
  }
}
