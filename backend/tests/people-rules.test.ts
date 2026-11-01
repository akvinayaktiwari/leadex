import { describe, expect, it } from 'vitest'
import { companyIdFor } from '../src/lib/lead-keys.js'
import type { PeopleDraft } from '../src/lib/schemas.js'
import { createLeadDataService } from '../src/services/lead-data-service.js'
import { decidePeople, emailBelongsTo, splitName } from '../src/services/people-rules.js'
import type { CompanyRecord } from '../src/types/index.js'
import { manualClock } from './support/in-memory-run-store.js'
import { memoryLeadData } from './support/lead-data-fixtures.js'
import { crawledPage, crawledSite } from './support/profile-fixtures.js'

const AT = '2026-11-01T12:00:00.000Z'
const COMPANY: CompanyRecord = {
  companyId: companyIdFor('acme.com'), domain: 'acme.com', name: 'Acme', keywords: [], country: 'IN', technologies: [], servedMarkets: [], updatedAt: AT,
}
const TEAM = 'Our team. Asha Rao Founder & CEO. Ravi Kumar Head of Marketing. Dr. Meera Iyer Chief Dentist. Team of Experts. John (former Managing Partner, retired 2019).'

function site() {
  return crawledSite([
    crawledPage('/', 'Acme dental clinic in Pune, India.', {
      people: [{ name: 'Asha Rao', title: 'Founder' }, { name: 'Unnamed Employee' }],
      emails: [{ email: 'info@acme.com', kind: 'general' }],
    }),
    crawledPage('/team', TEAM, { emails: [{ email: 'ravi.kumar@acme.com', kind: 'personal' }, { email: 'arao@acme.com', kind: 'personal' }] }),
  ])
}

const person = (name: string, title: string, quote: string, overrides: Partial<PeopleDraft['people'][number]> = {}): PeopleDraft['people'][number] =>
  ({ name, title, isCurrentStaff: true, sourceUrl: 'https://acme.com/team', quote, ...overrides })

describe('people rules', () => {
  // protects=markup people and model people backed by a quote naming both the person and the title are kept, owners first,
  // titles like "Dr." are stripped from names, and a person found twice is kept once;
  // fails_when=a quote without the title is trusted, the duplicate founder is stored twice, or a manager sorts above the founder;
  // no_claim=fixture pages; precision on real sites is measured with the labelled set (people:sample).
  it('keeps sourced people, owners first', () => {
    const decision = decidePeople(site(), COMPANY, { people: [
      person('Asha Rao', 'Founder & CEO', 'Asha Rao Founder & CEO'),
      person('Ravi Kumar', 'Head of Marketing', 'Ravi Kumar Head of Marketing'),
      person('Dr. Meera Iyer', 'Chief Dentist', 'Dr. Meera Iyer Chief Dentist'),
    ] }, AT)
    expect(decision.writes.map((write) => `${write.person.firstName} ${write.person.lastName}: ${write.person.title} (${write.person.seniority})`)).toEqual([
      'Asha Rao: Founder (owner)', 'Ravi Kumar: Head of Marketing (head)', 'Meera Iyer: Chief Dentist (staff)',
    ])
    expect(decision.rejected).toMatchObject({ duplicate: 1, no_title: 1 })
  })

  // protects=headings, single names, former staff, people the model marks as not current, quotes not on the page, quotes
  // without the title, and pages we did not crawl are all rejected with a reason;
  // fails_when=any of them becomes a person record;
  // no_claim=n/a.
  it('rejects people it cannot back', () => {
    const decision = decidePeople(crawledSite([crawledPage('/team', TEAM)]), COMPANY, { people: [
      person('Team of Experts', 'Leadership', 'Team of Experts'),
      person('John', 'Managing Partner', 'John (former Managing Partner'),
      person('John Smith', 'former Managing Partner', 'John (former Managing Partner, retired 2019)'),
      person('Ravi Kumar', 'Sales Director', 'Ravi Kumar Head of Marketing'),
      person('Asha Rao', 'Founder & CEO', 'Asha Rao Founder & CEO, since 2004'),
      person('Ravi Kumar', 'Head of Marketing', 'Ravi Kumar Head of Marketing', { sourceUrl: 'https://acme.com/about' }),
      person('Meera Iyer', 'Chief Dentist', 'Meera Iyer Chief Dentist', { isCurrentStaff: false }),
    ] }, AT)
    expect(decision.writes).toEqual([])
    expect(decision.rejected).toEqual({ not_a_name: 2, not_current: 2, unsourced: 3 })
  })

  // protects=a personal address is tied to a person only when it clearly fits their name and exactly one person fits; general
  // inboxes are company-level; every address keeps its page;
  // fails_when="arao@" is tied to Asha Rao while Anil Rao also works there, or info@ is tied to a person;
  // no_claim=does not verify any address (that is #24).
  it('links published emails to people carefully', () => {
    const decision = decidePeople(site(), COMPANY, { people: [
      person('Ravi Kumar', 'Head of Marketing', 'Ravi Kumar Head of Marketing'),
    ] }, AT)
    const rows = Object.fromEntries(decision.emails.map((row) => [row.email, `${row.kind}:${row.personKey === '' ? 'unlinked' : 'linked'}:${row.sourceUrl}`]))
    expect(rows).toEqual({
      'info@acme.com': 'general:unlinked:https://acme.com/', 'ravi.kumar@acme.com': 'personal:linked:https://acme.com/team', 'arao@acme.com': 'personal:linked:https://acme.com/team',
    })
    expect(emailBelongsTo('arao@acme.com', 'Asha', 'Rao')).toBe(true)
    expect(emailBelongsTo('arao@acme.com', 'Ravi', 'Kumar')).toBe(false)
    const twoRaos = decidePeople(crawledSite([crawledPage('/team', `${TEAM} Anil Rao Accountant.`, { emails: [{ email: 'arao@acme.com', kind: 'personal' }] })]), COMPANY, { people: [
      person('Asha Rao', 'Founder & CEO', 'Asha Rao Founder & CEO'), person('Anil Rao', 'Accountant', 'Anil Rao Accountant'),
    ] }, AT)
    expect(twoRaos.emails.map((row) => row.personKey)).toEqual([''])
  })

  // protects=what the rules produce passes the Leadex Data service unchanged (every field sourced, country allowed);
  // fails_when=seniority, department or country is stored without a fact and every save fails;
  // no_claim=memory repository.
  it('produces writes the lead data service accepts', async () => {
    const service = createLeadDataService({ repository: memoryLeadData(), clock: manualClock(AT) })
    const decision = decidePeople(site(), COMPANY, { people: [person('Ravi Kumar', 'Head of Marketing', 'Ravi Kumar Head of Marketing')] }, AT)
    for (const write of decision.writes) expect(await service.savePerson(write)).toMatchObject({ status: 'saved' })
  })

  // protects=name splitting keeps multi-word surnames and strips honorifics;
  // fails_when="Dr. Meera Iyer" keeps "Dr." as the first name or "Ana de la Cruz" loses part of the surname;
  // no_claim=does not handle family-name-first conventions.
  it('splits names', () => {
    expect(splitName('Dr. Meera Iyer')).toEqual({ firstName: 'Meera', lastName: 'Iyer' })
    expect(splitName('Ana de la Cruz')).toEqual({ firstName: 'Ana', lastName: 'de la Cruz' })
    expect(splitName('Madonna')).toBeUndefined()
  })
})
