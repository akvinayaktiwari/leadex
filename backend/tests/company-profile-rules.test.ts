import { describe, expect, it } from 'vitest'
import { createLeadDataService } from '../src/services/lead-data-service.js'
import { decideCompanyProfile, quoteOnPage } from '../src/services/company-profile-rules.js'
import { manualClock } from './support/in-memory-run-store.js'
import { memoryLeadData } from './support/lead-data-fixtures.js'
import { CONTACT_TEXT, HOME_TEXT, crawledPage, crawledSite, profileDraft } from './support/profile-fixtures.js'

const AT = '2026-11-01T10:00:00.000Z'

function site(homeSignals = {}, contactSignals = {}) {
  return crawledSite([crawledPage('/', HOME_TEXT, homeSignals), crawledPage('/contact', CONTACT_TEXT, contactSignals)])
}

function decide(...args: Parameters<typeof decideCompanyProfile>) {
  const decision = decideCompanyProfile(...args)
  if (!decision.ok) throw new Error(`expected a write, got skip: ${decision.reason}`)
  return decision.write
}

describe('company profile rules', () => {
  // protects=the model's country is accepted only with a quote that really appears on the page it cites;
  // fails_when=a made-up address ("MG Road, Mumbai") or a quote attributed to the wrong page places the company;
  // no_claim=a real quote can still be about a branch office rather than the head office.
  it('accepts a model country only with a verified quote', () => {
    expect(decide(site(), profileDraft(), AT).company).toMatchObject({ country: 'IN', city: 'Bengaluru', region: 'Karnataka' })
    const invented = profileDraft({ location: { ...profileDraft().location, quote: 'MG Road, Mumbai 400001' } })
    expect(decideCompanyProfile(site(), invented, AT)).toEqual({ ok: false, reason: 'unknown_country' })
    const wrongPage = profileDraft({ location: { ...profileDraft().location, sourceUrl: 'https://acme.com/' } })
    expect(decideCompanyProfile(site(), wrongPage, AT)).toEqual({ ok: false, reason: 'unknown_country' })
    expect(decideCompanyProfile(site(), profileDraft({ location: { ...profileDraft().location, country: 'UNKNOWN' } }), AT)).toEqual({ ok: false, reason: 'unknown_country' })
  })

  // protects=the site's own schema.org markup wins for country, city, name and legal name, recorded as structured_data;
  // fails_when=the model's guess overrides the markup, or a German address in markup is stored;
  // no_claim=markup is trusted as the site's own claim; it is not checked against registries (GLEIF does that in part 3).
  it('prefers structured data and blocks EU/EEA/UK countries from it', () => {
    const organization = { name: 'Acme Payroll', legalName: 'Acme Technologies Pvt Ltd', country: 'IN', city: 'Pune' }
    const write = decide(site({ organization, hasStructuredData: true }), profileDraft(), AT)
    expect(write.company).toMatchObject({ name: 'Acme Payroll', legalName: 'Acme Technologies Pvt Ltd', city: 'Pune' })
    expect(write.facts.filter((fact) => ['name', 'legalName', 'country', 'city'].includes(fact.field)).every((fact) => fact.method === 'structured_data')).toBe(true)
    expect(decideCompanyProfile(site({ organization: { country: 'DE' } }), profileDraft(), AT)).toEqual({ ok: false, reason: 'blocked_country' })
  })

  // protects=a field the model attributes to a page we never sent is dropped, not stored with a fake source;
  // fails_when=a description citing "https://acme.com/about" (not crawled) is kept;
  // no_claim=does not check that the description is a fair summary of the cited page.
  it('drops fields that cite pages we did not crawl', () => {
    const draft = profileDraft({ description: { value: 'Made-up claim', sourceUrl: 'https://acme.com/about' } })
    const write = decide(site(), draft, AT)
    expect(write.company.description).toBeUndefined()
    expect(write.facts.some((fact) => fact.field === 'description')).toBe(false)
    expect(write.company.keywords).toEqual(['payroll', 'hr'])
  })

  // protects=an employee band is set only from a stated, verifiable headcount;
  // fails_when=a guessed headcount with no quote, or a quote not on the page, sets a band;
  // no_claim=team-page counts can be out of date.
  it('sets the employee band only from a verified quote', () => {
    const stated = profileDraft({ employeeCount: { value: 45, sourceUrl: 'https://acme.com/', quote: 'Our team of 45 people' } })
    expect(decide(site(), stated, AT).company.employeeBand).toBe('11-50')
    const guessed = profileDraft({ employeeCount: { value: 300, sourceUrl: 'https://acme.com/', quote: 'about 300 staff' } })
    expect(decide(site(), guessed, AT).company.employeeBand).toBeUndefined()
  })

  // protects=non-businesses and unnamed sites are skipped with a reason;
  // fails_when=a blog or parked domain is stored, or a company with no sourced name is stored;
  // no_claim=n/a.
  it('skips non-businesses and unnamed companies', () => {
    expect(decideCompanyProfile(site(), profileDraft({ isBusiness: false, notBusinessReason: 'personal blog' }), AT)).toEqual({ ok: false, reason: 'not_a_business' })
    expect(decideCompanyProfile(site(), profileDraft({ name: { value: 'Acme', sourceUrl: 'https://elsewhere.com/' } }), AT)).toEqual({ ok: false, reason: 'no_provenance' })
  })

  // protects=signals become facts with the page they were seen on: technologies per page, agency, job boards, schema presence;
  // fails_when=a pixel seen only on /contact is attributed to the homepage, or a duplicate board is recorded twice;
  // no_claim=signals are only as good as the HTML patterns in site-signals.
  it('records signals with their source pages', () => {
    const write = decide(site(
      { technologies: ['google_ads'], agency: { name: 'Pixelworks', url: 'https://pixelworks.studio', confidence: 0.9 } },
      { technologies: ['meta_pixel'], jobBoards: [{ provider: 'lever', board: 'acme', url: 'https://jobs.lever.co/acme' }, { provider: 'lever', board: 'acme', url: 'https://jobs.lever.co/acme/1' }] },
    ), profileDraft(), AT)
    const facts = new Map(write.facts.filter((fact) => fact.field.startsWith('signal.') || fact.field === 'technologies').map((fact) => [`${fact.field}=${fact.value}`, fact.sourceUrl]))
    expect(Object.fromEntries(facts)).toEqual({
      'technologies=google_ads': 'https://acme.com/', 'technologies=meta_pixel': 'https://acme.com/contact',
      'signal.tech.google_ads=true': 'https://acme.com/', 'signal.tech.meta_pixel=true': 'https://acme.com/contact',
      'signal.structured_data=false': 'https://acme.com/',
      'signal.agency={"name":"Pixelworks","url":"https://pixelworks.studio","confidence":0.9}': 'https://acme.com/',
      'signal.job_board=lever:acme': 'https://acme.com/contact',
    })
  })

  // protects=what the profiler produces passes the Leadex Data service's provenance check unchanged (rules and service agree);
  // fails_when=the profiler fills a field (e.g. technologies or region) without a matching fact and every save fails;
  // no_claim=memory repository; the ClickHouse round-trip is covered by the lead-data tests.
  it('produces writes the lead data service accepts', async () => {
    const repository = memoryLeadData()
    const service = createLeadDataService({ repository, clock: manualClock(AT) })
    const write = decide(site({ technologies: ['hubspot'] }), profileDraft({ employeeCount: { value: 45, sourceUrl: 'https://acme.com/', quote: 'team of 45' } }), AT)
    expect(await service.saveCompany(write)).toMatchObject({ status: 'saved' })
    const [stored] = repository.companies
    expect(await service.loadDeliverableCompanies([stored!])).toHaveLength(1)
  })

  // protects=quote matching ignores case and spacing but not content;
  // fails_when="bengaluru  560038" fails to match, or a 2-character quote matches anything;
  // no_claim=n/a.
  it('matches quotes loosely on spacing only', () => {
    const pages = [crawledPage('/contact', CONTACT_TEXT)]
    expect(quoteOnPage(pages, 'https://acme.com/contact', 'INDIRANAGAR,   bengaluru 560038')).toBe(true)
    expect(quoteOnPage(pages, 'https://acme.com/contact', 'In')).toBe(false)
    expect(quoteOnPage(pages, 'https://acme.com/contact', 'Bengaluru 560039')).toBe(false)
  })
})
