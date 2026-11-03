import type { CompanyProfileDraft } from '../../src/lib/schemas.js'
import type { CrawledPage, CrawledSite, PageSignals } from '../../src/types/index.js'

export function crawledPage(path: string, text: string, signals: Partial<PageSignals> = {}): CrawledPage {
  const url = `https://acme.com${path}`
  return { url, path, title: `Acme ${path}`, description: '', text, signals: { technologies: [], hasStructuredData: false, jobBoards: [], people: [], emails: [], ...signals } }
}

export function crawledSite(pages: CrawledPage[]): CrawledSite {
  return { domain: 'acme.com', origin: 'https://acme.com', pages, blockedByRobots: 0, failedPages: 0, fetchedAt: '2026-11-02T10:00:00.000Z' }
}

// A draft citing the homepage for everything and placing the company in Bengaluru, India, by a quote on /contact.
export function profileDraft(overrides: Partial<CompanyProfileDraft> = {}): CompanyProfileDraft {
  const home = 'https://acme.com/'
  return {
    isBusiness: true, notBusinessReason: '',
    name: { value: 'Acme', sourceUrl: home }, legalName: { value: '', sourceUrl: '' },
    description: { value: 'Payroll software for small businesses in India.', sourceUrl: home },
    industry: { value: 'software', sourceUrl: home },
    keywords: { value: ['Payroll', 'HR', 'payroll'], sourceUrl: home },
    employeeCount: { value: 0, sourceUrl: '', quote: '' },
    location: { country: 'IN', region: 'Karnataka', city: 'Bengaluru', sourceUrl: 'https://acme.com/contact', quote: 'Indiranagar, Bengaluru 560038' },
    servedMarkets: { value: ['IN'], sourceUrl: home },
    ...overrides,
  }
}

export const HOME_TEXT = 'Acme payroll software for small businesses in India. Run payroll in minutes. Our team of 45 people.'
export const CONTACT_TEXT = 'Visit us: 12 CMH Road, Indiranagar, Bengaluru 560038, India. Phone +91 80 4000 1234.'
