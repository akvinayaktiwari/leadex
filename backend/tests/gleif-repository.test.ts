import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { deflateRawSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createGleifRepository } from '../src/repositories/gleif-repository.js'
import type { GleifRecord } from '../src/types/index.js'

const HEADER = [
  'LEI', 'Entity.LegalName', 'Entity.LegalName.xmllang', 'Entity.OtherEntityNames.OtherEntityName.1', 'Entity.TransliteratedOtherEntityNames.TransliteratedOtherEntityName.1',
  'Entity.LegalAddress.City', 'Entity.LegalAddress.Country', 'Entity.HeadquartersAddress.City', 'Entity.HeadquartersAddress.Country',
  'Entity.LegalJurisdiction', 'Entity.EntityCategory', 'Entity.LegalForm.EntityLegalFormCode', 'Entity.EntityStatus', 'Registration.RegistrationStatus',
]
const ROWS = [
  ['5493001KJTIIGC8Y1R12', 'ACME TECHNOLOGIES PRIVATE LIMITED', 'en', '"Acme, Tech"', '', 'BENGALURU', 'IN', 'BENGALURU', 'IN', 'IN', 'GENERAL', 'XXXX', 'ACTIVE', 'ISSUED'],
  ['529900T8BM49AURSDO55', '"Multi\nLine GmbH"', 'de', '', 'MULTI LINE', 'BERLIN', 'DE', 'BERLIN', 'DE', 'DE', 'GENERAL', '2HBR', 'ACTIVE', 'LAPSED'],
]
const CSV = `﻿${[HEADER.join(','), ...ROWS.map((row) => row.join(','))].join('\r\n')}\r\n`

// A one-entry zip: local header, deflated data, then a fake central directory that must never be parsed.
function zip(content: string, zip64: boolean): Buffer {
  const name = Buffer.from('lei2.csv')
  const data = deflateRawSync(Buffer.from(content))
  const extra = zip64 ? Buffer.alloc(20) : Buffer.alloc(0)
  if (zip64) {
    extra.writeUInt16LE(0x0001, 0); extra.writeUInt16LE(16, 2)
    extra.writeBigUInt64LE(BigInt(Buffer.byteLength(content)), 4); extra.writeBigUInt64LE(BigInt(data.length), 12)
  }
  const header = Buffer.alloc(30)
  header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(45, 4); header.writeUInt16LE(2, 6); header.writeUInt16LE(8, 8)
  header.writeUInt32LE(zip64 ? 0xffffffff : data.length, 18); header.writeUInt32LE(zip64 ? 0xffffffff : Buffer.byteLength(content), 22)
  header.writeUInt16LE(name.length, 26); header.writeUInt16LE(extra.length, 28)
  return Buffer.concat([header, name, extra, data, Buffer.from('PK\u0001\u0002 central directory, not deflate data')])
}

describe('GLEIF repository (local HTTP server)', () => {
  let server: Server
  let base = ''
  const files: Record<string, Buffer> = {}

  beforeAll(async () => {
    files['/plain.zip'] = zip(CSV, false)
    files['/zip64.zip'] = zip(CSV, true)
    files['/not-a-zip.zip'] = Buffer.from('<html>maintenance</html>'.padEnd(64, ' '))
    files['/publishes/latest'] = Buffer.from(JSON.stringify({ data: {
      publish_date: '2026-11-01 08:00:00',
      lei2: { full_file: { csv: { url: 'https://g.example/full.csv.zip', record_count: 3481100 } }, delta_files: { LastDay: { csv: { url: 'https://g.example/day.csv.zip', record_count: 9934 } } } },
    } }))
    server = createServer((request, response) => {
      const body = files[request.url ?? '']
      if (!body) return void response.writeHead(404).end()
      response.writeHead(200).end(body)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  async function collect(path: string): Promise<GleifRecord[]> {
    const records: GleifRecord[] = []
    for await (const record of createGleifRepository(`${base}/publishes/latest`, 'test').streamRecords(`${base}${path}`)) records.push(record)
    return records
  }

  // protects=records stream out of both plain and ZIP64 zips (GLEIF's is ZIP64), with quoted commas, newlines, a BOM and other
  // names, and the trailing central directory is never parsed;
  // fails_when=the ZIP64 size is misread, the central directory corrupts the last row, or quoted fields split;
  // no_claim=fixture CSV with the real column names; the real 484 MB file is not downloaded in tests.
  it('streams records from plain and ZIP64 zips', async () => {
    for (const path of ['/plain.zip', '/zip64.zip']) {
      const records = await collect(path)
      expect(records.map((record) => record.lei), path).toEqual(['5493001KJTIIGC8Y1R12', '529900T8BM49AURSDO55'])
      expect(records[0]).toMatchObject({ legalName: 'ACME TECHNOLOGIES PRIVATE LIMITED', otherNames: ['Acme, Tech'], legalCountry: 'IN', hqCity: 'BENGALURU', entityStatus: 'ACTIVE', registrationStatus: 'ISSUED' })
      expect(records[1]).toMatchObject({ legalName: 'Multi\nLine GmbH', otherNames: ['MULTI LINE'], registrationStatus: 'LAPSED' })
    }
  })

  // protects=a response that is not a zip (e.g. a maintenance page) fails the job instead of importing nothing;
  // fails_when=the loop ends normally with zero records;
  // no_claim=n/a.
  it('fails on a file that is not a zip', async () => {
    await expect(collect('/not-a-zip.zip')).rejects.toThrow(/Not a zip/)
  })

  // protects=the publishes API is read into the full and last-day CSV URLs with an ISO publish date;
  // fails_when=the JSON shape changes silently (zod rejects it) or the date keeps GLEIF's space format;
  // no_claim=n/a.
  it('reads the latest publish', async () => {
    expect(await createGleifRepository(`${base}/publishes/latest`, 'test').latestPublish()).toEqual({
      publishDate: '2026-11-01T08:00:00Z', fullCsvUrl: 'https://g.example/full.csv.zip', fullRecords: 3481100, lastDayCsvUrl: 'https://g.example/day.csv.zip',
    })
  })
})
