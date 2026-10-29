import { describe, expect, it } from 'vitest'
import { LeadDataRuleError } from '../src/lib/errors.js'
import { companyIdFor } from '../src/lib/lead-keys.js'
import { createLeadDataService } from '../src/services/lead-data-service.js'
import type { CompanyFilters, CompanyRecord } from '../src/types/index.js'
import { manualClock } from './support/in-memory-run-store.js'
import { companyWrite, memoryLeadData, personWrite } from './support/lead-data-fixtures.js'

const ANY: CompanyFilters = { industries: [], employeeMin: 0, employeeMax: 0, countries: [], keywords: [], technologies: [] }

function setup() {
  const repository = memoryLeadData()
  return { repository, service: createLeadDataService({ repository, clock: manualClock('2026-10-29T09:00:00.000Z') }) }
}

async function expectRule(promise: Promise<unknown>, code: LeadDataRuleError['code']): Promise<void> {
  await expect(promise).rejects.toSatisfy((error: unknown) => error instanceof LeadDataRuleError && error.code === code)
}

describe('lead data service: writes', () => {
  // protects=a valid company is stored with a normalized domain, derived id, server timestamp, and one fact row per input fact;
  // fails_when=the domain keeps www/case, facts lose their entity id, or the record is written without its facts;
  // no_claim=in-memory repository; ClickHouse round-trip is in clickhouse-lead-data.test.ts.
  it('saves a company with its facts', async () => {
    const { repository, service } = setup()
    const write = companyWrite({ domain: 'WWW.Acme.com' })
    expect(await service.saveCompany(write)).toEqual({ status: 'saved', entityId: companyIdFor('acme.com') })
    expect(repository.companies).toMatchObject([{ domain: 'acme.com', country: 'US', updatedAt: '2026-10-29T09:00:00.000Z' }])
    expect(repository.facts).toHaveLength(write.facts.length)
    expect(new Set(repository.facts.map((fact) => fact.entityId))).toEqual(new Set([companyIdFor('acme.com')]))
  })

  // protects=nothing is stored when a claimed field has no source (criterion 10c at write time);
  // fails_when=a company with an unsourced city, or a person with an unsourced title, reaches the database;
  // no_claim=does not judge whether the source is trustworthy.
  it('refuses records with unsourced fields', async () => {
    const { repository, service } = setup()
    const company = companyWrite()
    await expectRule(service.saveCompany({ ...company, company: { ...company.company, city: 'Austin' } }), 'missing_provenance')
    const person = personWrite()
    await expectRule(service.savePerson({ ...person, facts: person.facts.filter((fact) => fact.field !== 'title') }), 'missing_provenance')
    expect(repository.companies).toHaveLength(0)
    expect(repository.people).toHaveLength(0)
    expect(repository.facts).toHaveLength(0)
  })

  // protects=EU/EEA/UK and unknown-country records are never stored (criterion 10, write side);
  // fails_when=a German company, a UK person or a person with no country is written;
  // no_claim=relies on the source's country; a wrong country from a source is not detected.
  it('refuses blocked and unknown countries', async () => {
    const { repository, service } = setup()
    await expectRule(service.saveCompany(companyWrite({ country: 'DE' })), 'blocked_country')
    await expectRule(service.savePerson(personWrite({ country: 'gb' })), 'blocked_country')
    await expectRule(service.savePerson(personWrite({ country: '' })), 'blocked_country')
    expect(repository.companies.length + repository.people.length + repository.facts.length).toBe(0)
  })

  // protects=required identity fields are enforced;
  // fails_when=a person with a blank last name or title is stored;
  // no_claim=does not validate that names are real names.
  it('refuses records missing required fields', async () => {
    const { service } = setup()
    await expectRule(service.savePerson(personWrite({ title: '  ' })), 'invalid_record')
    await expectRule(service.saveCompany(companyWrite({ name: '' })), 'invalid_record')
  })

  // protects=a suppressed person or domain is never stored again (the re-collection half of criterion 10d);
  // fails_when=a re-crawl re-creates a person who asked to be removed, or anyone at a suppressed domain;
  // no_claim=the remove-me flow itself is #26.
  it('skips suppressed people and domains', async () => {
    const { repository, service } = setup()
    const first = await service.savePerson(personWrite())
    repository.people.length = 0
    repository.facts.length = 0
    await service.suppress('person', first.entityId, 'removal_request')
    expect(await service.savePerson(personWrite({ firstName: 'ASHA' }))).toMatchObject({ status: 'suppressed' })
    await service.suppress('domain', 'acme.com', 'opt_out')
    expect(await service.saveCompany(companyWrite())).toMatchObject({ status: 'suppressed' })
    expect(await service.savePerson(personWrite({ firstName: 'Ravi' }))).toMatchObject({ status: 'suppressed' })
    expect(repository.people.length + repository.companies.length + repository.facts.length).toBe(0)
    expect(repository.suppression.every((entry) => !entry.valueHash.includes('acme'))).toBe(true)
  })
})

describe('lead data service: reads', () => {
  // protects=reads drop EU/EEA/UK rows even if the repository returns them (criterion 10, read side, defence in depth);
  // fails_when=a blocked-country row inserted outside the service is returned;
  // no_claim=the ClickHouse query's own exclusion is tested in clickhouse-lead-data.test.ts.
  it('never returns blocked-country rows', async () => {
    const { repository, service } = setup()
    await service.saveCompany(companyWrite())
    const leaked: CompanyRecord = { ...repository.companies[0]!, domain: 'eu.example', companyId: 'eu', country: 'FR' }
    repository.companies.push(leaked)
    expect((await service.findCompanies(ANY, 10)).map((company) => company.domain)).toEqual(['acme.com'])
  })

  // protects=asking only for blocked countries returns nothing, instead of falling back to "any country";
  // fails_when=countries ['DE'] turns into an empty filter and returns US companies;
  // no_claim=n/a.
  it('returns nothing when only blocked countries are requested', async () => {
    const { service } = setup()
    await service.saveCompany(companyWrite())
    expect(await service.findCompanies({ ...ANY, countries: ['DE', 'gb'] }, 10)).toEqual([])
  })

  // protects=people at a suppressed domain, or suppressed individually, are filtered out of reads;
  // fails_when=a person stored before their removal request is still returned;
  // no_claim=deleting their stored rows is #26.
  it('filters suppressed people out of reads', async () => {
    const { service } = setup()
    const asha = await service.savePerson(personWrite())
    await service.savePerson(personWrite({ firstName: 'Ravi' }))
    await service.suppress('person', asha.entityId, 'removal_request')
    expect((await service.findPeople(['www.acme.com'], [], 10)).map((person) => person.firstName)).toEqual(['Ravi'])
    await service.suppress('domain', 'acme.com', 'opt_out')
    expect(await service.findPeople(['acme.com'], [], 10)).toEqual([])
  })
})

describe('lead data service: delivery (criterion 10c)', () => {
  // protects=a record is deliverable only when every populated field has a stored fact;
  // fails_when=a company written straight to the repository without facts is delivered;
  // no_claim=delivery itself (CSV, push) is #13/#14; this is the gate they call.
  it('refuses to deliver records without provenance', async () => {
    const { repository, service } = setup()
    await service.saveCompany(companyWrite())
    const [saved] = repository.companies
    const deliverable = await service.loadDeliverableCompanies([saved!])
    expect(deliverable[0]?.facts.map((fact) => fact.field).sort()).toEqual(['country', 'domain', 'employeeBand', 'industry', 'keywords', 'name', 'servedMarkets', 'technologies'])
    const unsourced: CompanyRecord = { ...saved!, companyId: 'no-facts', domain: 'bare.example' }
    await expectRule(service.loadDeliverableCompanies([unsourced]), 'missing_provenance')
  })

  // protects=people are delivered only with facts for every field, and a later-added field without a fact blocks delivery;
  // fails_when=a person whose title was changed without a new fact is delivered;
  // no_claim=does not compare fact values to the current field value.
  it('checks people the same way', async () => {
    const { repository, service } = setup()
    await service.savePerson(personWrite())
    const person = repository.people[0]!
    expect(await service.loadDeliverablePeople([person])).toHaveLength(1)
    await expectRule(service.loadDeliverablePeople([{ ...person, department: 'marketing' }]), 'missing_provenance')
  })
})
