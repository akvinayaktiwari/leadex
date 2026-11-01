// Pure rules that turn people pages, their markup and the model's draft into sourced person writes (#23).
import { departmentOf, seniorityOf, seniorityRank } from '../lib/job-titles.js'
import { personKeyFor } from '../lib/lead-keys.js'
import type { PeopleDraft } from '../lib/schemas.js'
import type {
  CompanyRecord, CrawledSite, FactInput, FactMethod, PeopleDecision, PersonField, PersonRejection, PersonWrite, PublishedEmailRow,
} from '../types/index.js'
import { quoteOnPage } from './company-profile-rules.js'

const MAX_PEOPLE_PER_COMPANY = 25
const NAME_TOKEN = /^[\p{L}][\p{L}'’.-]*$/u
// Words that make a heading, not a person ("Team of Experts", "Our Services").
const NOT_NAME_WORDS = new Set(['team', 'our', 'the', 'and', 'of', 'experts', 'services', 'solutions', 'about', 'us', 'contact', 'staff', 'members', 'company', 'group', 'leadership', 'management', 'meet', 'board', 'clinic', 'office'])
const NOT_CURRENT = /\b(former|ex-|late|retired|emeritus|in memoriam|passed away)\b/i

interface Candidate {
  name: string
  title: string
  sourceUrl: string
  method: FactMethod
  quote?: string | undefined
}

const squash = (value: string): string => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()

export function splitName(name: string): { firstName: string; lastName: string } | undefined {
  const tokens = name.replace(/^(dr|mr|mrs|ms|prof|ca|adv|er)\.?\s+/i, '').trim().split(/\s+/)
  if (tokens.length < 2 || tokens.length > 5) return undefined
  if (!tokens.every((token) => NAME_TOKEN.test(token)) || tokens.some((token) => NOT_NAME_WORDS.has(token.toLowerCase()))) return undefined
  return { firstName: tokens[0] as string, lastName: tokens.slice(1).join(' ') }
}

function structuredCandidates(site: CrawledSite): Candidate[] {
  return site.pages.flatMap((page) => (page.signals?.people ?? []).map((person) => ({
    name: person.name, title: person.title ?? '', sourceUrl: page.url, method: 'structured_data' as const,
  })))
}

function modelCandidates(draft: PeopleDraft): Candidate[] {
  return draft.people.map((person) => ({
    name: person.name.trim(), title: person.isCurrentStaff ? person.title.trim() : `former ${person.title}`,
    sourceUrl: person.sourceUrl, method: 'page_extract' as const, quote: person.quote,
  }))
}

function rejectionFor(site: CrawledSite, candidate: Candidate): PersonRejection | undefined {
  if (NOT_CURRENT.test(candidate.title)) return 'not_current'
  if (!splitName(candidate.name)) return 'not_a_name'
  if (candidate.title === '') return 'no_title'
  if (!site.pages.some((page) => page.url === candidate.sourceUrl)) return 'unsourced'
  if (candidate.method === 'structured_data') return undefined
  // The quote must be on the cited page and name both the person and the title.
  const quote = squash(candidate.quote ?? '')
  const backed = quoteOnPage(site.pages, candidate.sourceUrl, candidate.quote ?? '') && quote.includes(squash(candidate.name)) && quote.includes(squash(candidate.title))
  return backed ? undefined : 'unsourced'
}

function toWrite(company: CompanyRecord, candidate: Candidate, homepage: string, retrievedAt: string): PersonWrite {
  const { firstName, lastName } = splitName(candidate.name) as { firstName: string; lastName: string }
  const seniority = seniorityOf(candidate.title)
  const department = departmentOf(candidate.title)
  const fact = (field: PersonField, value: string, sourceUrl: string, method: FactMethod): FactInput<PersonField> =>
    ({ field, value, sourceUrl, method, source: 'website', licenceScope: 'owned', retrievedAt })
  const { sourceUrl, method } = candidate
  return {
    person: { domain: company.domain, firstName, lastName, title: candidate.title, seniority, department, country: company.country, isOfficer: false },
    facts: [
      fact('domain', company.domain, homepage, 'page_extract'), fact('firstName', firstName, sourceUrl, method), fact('lastName', lastName, sourceUrl, method),
      fact('title', candidate.title, sourceUrl, method), fact('seniority', seniority, sourceUrl, 'derived'), fact('department', department, sourceUrl, 'derived'),
      // Assumed from the company's country: a person listed as staff is placed where the company is.
      fact('country', company.country, sourceUrl, 'derived'),
    ],
  }
}

function count(rejected: PeopleDecision['rejected'], reason: PersonRejection): void {
  rejected[reason] = (rejected[reason] ?? 0) + 1
}

// "asha.rao@", "arao@", "asha@", "raoa@", "asharao@" belong to Asha Rao; anything else stays unlinked.
export function emailBelongsTo(email: string, firstName: string, lastName: string): boolean {
  const local = (email.split('@')[0] ?? '').replace(/[._-]/g, '')
  const first = firstName.toLowerCase().replace(/[^a-z]/g, '')
  const last = (lastName.split(' ').pop() ?? '').toLowerCase().replace(/[^a-z]/g, '')
  if (!first || !last) return false
  return [first, `${first}${last}`, `${first[0]}${last}`, `${last}${first[0]}`, `${last}${first}`, `${first}${last[0]}`].includes(local)
}

function emailRows(site: CrawledSite, company: CompanyRecord, writes: PersonWrite[], seenAt: string): PublishedEmailRow[] {
  const rows = new Map<string, PublishedEmailRow>()
  for (const page of site.pages) {
    for (const found of page.signals?.emails ?? []) {
      const owners = found.kind === 'personal' ? writes.filter((write) => emailBelongsTo(found.email, write.person.firstName, write.person.lastName)) : []
      // An address two named people could own is evidence of format only, never tied to either.
      const owner = owners.length === 1 ? owners[0] : undefined
      const personKey = owner ? personKeyFor(owner.person.firstName, owner.person.lastName, company.domain) : ''
      if (!rows.has(found.email)) rows.set(found.email, { domain: company.domain, email: found.email, kind: found.kind, personKey, sourceUrl: page.url, seenAt })
    }
  }
  return [...rows.values()]
}

export function decidePeople(site: CrawledSite, company: CompanyRecord, draft: PeopleDraft, retrievedAt: string): PeopleDecision {
  const homepage = site.pages[0]?.url ?? `https://${company.domain}/`
  const rejected: PeopleDecision['rejected'] = {}
  const byKey = new Map<string, PersonWrite>()
  for (const candidate of [...structuredCandidates(site), ...modelCandidates(draft)]) {
    const reason = rejectionFor(site, candidate)
    if (reason) {
      count(rejected, reason)
      continue
    }
    const write = toWrite(company, candidate, homepage, retrievedAt)
    const key = personKeyFor(write.person.firstName, write.person.lastName, company.domain)
    if (byKey.has(key)) count(rejected, 'duplicate')
    else byKey.set(key, write)
  }
  const writes = [...byKey.values()]
    .sort((a, b) => seniorityRank(seniorityOf(a.person.title)) - seniorityRank(seniorityOf(b.person.title)))
    .slice(0, MAX_PEOPLE_PER_COMPANY)
  return { writes, rejected, emails: emailRows(site, company, writes, retrievedAt) }
}
