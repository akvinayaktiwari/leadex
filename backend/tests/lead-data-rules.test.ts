import { describe, expect, it } from 'vitest'
import { isAllowedCountry, normalizeCountry } from '../src/lib/countries.js'
import { employeeBandFor, employeeBandsBetween } from '../src/lib/employee-bands.js'
import { companyIdFor, personKeyFor, suppressionHash } from '../src/lib/lead-keys.js'
import { missingProvenance, populatedFields } from '../src/services/lead-data-rules.js'
import { splitStatements } from '../src/services/lead-data-migration-service.js'
import { readMigrationFiles } from '../tools/clickhouse-migrate.js'

describe('country guard (criterion 10)', () => {
  // protects=EU, EEA and UK records are blocked, including lowercase input and the EL/UK aliases;
  // fails_when=a member state, Norway/Iceland/Liechtenstein, the UK or an alias is allowed;
  // no_claim=does not decide a record's country; the source must supply it.
  it('blocks EU/EEA/UK countries and aliases', () => {
    for (const code of ['de', 'FR', 'IE', 'NO', 'IS', 'LI', 'GB', 'UK', 'EL', ' se ']) expect(isAllowedCountry(code), code).toBe(false)
    for (const code of ['US', 'in', 'AE', 'SG', 'CH']) expect(isAllowedCountry(code), code).toBe(true)
  })

  // protects=a record with an unknown or malformed country is refused (fail closed);
  // fails_when=an empty, numeric or 3-letter code passes as allowed;
  // no_claim=does not validate against the full ISO list.
  it('fails closed on unknown countries', () => {
    for (const code of ['', 'USA', '1A', 'I']) expect(isAllowedCountry(code), code).toBe(false)
    expect(normalizeCountry(' us ')).toBe('US')
  })
})

describe('lead keys', () => {
  // protects=the same company or person always gets the same id regardless of case, spacing or www;
  // fails_when=a re-crawl of "WWW.Acme.com" creates a second company, or "Asha  Rao" a second person;
  // no_claim=does not merge people whose names are spelled differently.
  it('normalizes before hashing', () => {
    expect(companyIdFor('WWW.Acme.com.')).toBe(companyIdFor('acme.com'))
    expect(personKeyFor(' Asha ', 'RAO', 'www.acme.com')).toBe(personKeyFor('asha', 'rao', 'acme.com'))
    expect(personKeyFor('Asha', 'Rao', 'acme.com')).not.toBe(personKeyFor('Asha', 'Rao', 'acme.io'))
  })

  // protects=suppression hashes are namespaced by kind and normalized;
  // fails_when=an email and a domain with the same text collide, or "A@B.com" misses "a@b.com";
  // no_claim=hashes are not secret against a dictionary attack on known emails.
  it('hashes suppression values by kind', () => {
    expect(suppressionHash('email', 'A@Acme.com ')).toBe(suppressionHash('email', 'a@acme.com'))
    expect(suppressionHash('domain', 'www.acme.com')).toBe(suppressionHash('domain', 'acme.com'))
    expect(suppressionHash('email', 'acme.com')).not.toBe(suppressionHash('domain', 'acme.com'))
  })
})

describe('provenance rules (criterion 10c)', () => {
  // protects=every field that makes a claim needs a fact; derived ids and empty values do not;
  // fails_when=an empty list or false flag demands a fact, or a filled field is skipped;
  // no_claim=does not check that the fact value matches the record value.
  it('finds populated fields and the ones without a fact', () => {
    const record = { companyId: 'x', updatedAt: 't', name: 'Acme', city: '', keywords: [], technologies: ['go'], isOfficer: false, lei: undefined }
    const fields = populatedFields(record, ['companyId', 'updatedAt'])
    expect(fields).toEqual(['name', 'technologies'])
    expect(missingProvenance(fields, ['name'])).toEqual(['technologies'])
    expect(populatedFields({ isOfficer: true }, [])).toEqual(['isOfficer'])
  })
})

describe('employee bands', () => {
  // protects=a size range maps to every overlapping band, and 0 means no size filter;
  // fails_when=11-200 misses 51-200, or max 0 filters everything out;
  // no_claim=bands are coarse; a 60-person company matches a 11-55 filter via the 51-200 band.
  it('maps ranges and counts to bands', () => {
    expect(employeeBandsBetween(11, 200)).toEqual(['11-50', '51-200'])
    expect(employeeBandsBetween(4000, 100000)).toEqual(['1001-5000', '5001+'])
    expect(employeeBandsBetween(0, 0)).toEqual([])
    expect(employeeBandFor(60)).toBe('51-200')
    expect(employeeBandFor(0)).toBeUndefined()
  })
})

describe('migration statements', () => {
  // protects=the real migration file splits into its six CREATE TABLE statements, comments removed;
  // fails_when=a comment containing ";" or a blank tail produces an extra or broken statement;
  // no_claim=does not support ";" inside string literals (documented limit).
  it('splits SQL into statements without comments', () => {
    const sql = '-- header; not a statement\nCREATE TABLE a (x String); -- trailing\n\nCREATE TABLE b (y String);\n'
    expect(splitStatements(sql)).toEqual(['CREATE TABLE a (x String)', 'CREATE TABLE b (y String)'])
    const [file] = readMigrationFiles()
    const tables = splitStatements(file?.sql ?? '').map((statement) => /CREATE TABLE IF NOT EXISTS (\w+)/.exec(statement)?.[1])
    expect(tables).toEqual(['companies', 'people', 'facts', 'domain_patterns', 'emails', 'suppression'])
  })
})
