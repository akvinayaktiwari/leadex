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

export const VALID_DRAFT = {
  name: 'Acme Invoicing',
  oneLiner: 'Invoicing software for small agencies in India',
  valueProps: ['Send GST invoices in seconds', 'Automatic payment reminders', 'UPI and card payments'],
  category: 'invoicing software for small businesses',
  pricingSignals: ['free trial', 'from INR 499 per month'],
  servedMarkets: ['IN'],
}
