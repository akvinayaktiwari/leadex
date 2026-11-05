import { createReadStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Transform, pipeline, type TransformCallback } from 'node:stream'
import { createInflateRaw } from 'node:zlib'
import { parse } from 'csv-parse'
import { z } from 'zod'
import type { GleifPublish, GleifRecord, GleifSource } from '../types/index.js'
import { logInfo } from '../lib/logger.js'
import { RETRY_POLICY, downloadToFile } from './http-download.js'

const LOCAL_HEADER_SIGNATURE = 0x04034b50
const DEFLATE = 8
const ZIP64_EXTRA_ID = 0x0001

// Passes through exactly the compressed bytes of the zip's first entry (local header skipped), then ends,
// so the central directory at the end of the file never reaches the inflater. Handles ZIP64 sizes.
export class FirstZipEntry extends Transform {
  private header: Buffer = Buffer.alloc(0)
  private remaining: bigint | undefined

  override _transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback): void {
    try {
      if (this.remaining === undefined) {
        this.header = Buffer.concat([this.header, chunk])
        const parsed = this.parseHeader()
        if (parsed === undefined) return done()
        this.remaining = parsed.size
        chunk = this.header.subarray(parsed.dataStart)
      }
      this.forward(chunk)
      done()
    } catch (error) {
      done(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private forward(chunk: Buffer): void {
    if (this.remaining === undefined || this.remaining <= 0n) return
    const take = BigInt(chunk.length) < this.remaining ? chunk : chunk.subarray(0, Number(this.remaining))
    this.remaining -= BigInt(take.length)
    this.push(take)
    if (this.remaining === 0n) this.push(null)
  }

  private parseHeader(): { dataStart: number; size: bigint } | undefined {
    const buffer = this.header
    if (buffer.length < 30) return undefined
    if (buffer.readUInt32LE(0) !== LOCAL_HEADER_SIGNATURE) throw new Error('Not a zip file (no local file header)')
    if (buffer.readUInt16LE(8) !== DEFLATE) throw new Error('Unsupported zip compression (expected deflate)')
    if (buffer.readUInt16LE(6) & 0x8) throw new Error('Zip entry sizes are in a data descriptor; streaming is not supported')
    const nameLength = buffer.readUInt16LE(26)
    const extraLength = buffer.readUInt16LE(28)
    const dataStart = 30 + nameLength + extraLength
    if (buffer.length < dataStart) return undefined
    const size = buffer.readUInt32LE(18)
    if (size !== 0xffffffff) return { dataStart, size: BigInt(size) }
    return { dataStart, size: zip64CompressedSize(buffer.subarray(30 + nameLength, dataStart)) }
  }
}

// ZIP64 extra field: uncompressed size (8 bytes) then compressed size (8 bytes).
function zip64CompressedSize(extra: Buffer): bigint {
  for (let offset = 0; offset + 4 <= extra.length;) {
    const id = extra.readUInt16LE(offset)
    const length = extra.readUInt16LE(offset + 2)
    if (id === ZIP64_EXTRA_ID && length >= 16) return extra.readBigUInt64LE(offset + 4 + 8)
    offset += 4 + length
  }
  throw new Error('ZIP64 sizes missing from the local header')
}

const OTHER_NAME_COLUMN = /^Entity\.(Transliterated)?OtherEntityNames\.(Transliterated)?OtherEntityName\.\d+$/

const COLUMNS = {
  lei: 'LEI', legalName: 'Entity.LegalName', legalCountry: 'Entity.LegalAddress.Country', legalCity: 'Entity.LegalAddress.City',
  hqCountry: 'Entity.HeadquartersAddress.Country', hqCity: 'Entity.HeadquartersAddress.City', jurisdiction: 'Entity.LegalJurisdiction',
  category: 'Entity.EntityCategory', legalForm: 'Entity.LegalForm.EntityLegalFormCode', entityStatus: 'Entity.EntityStatus',
  registrationStatus: 'Registration.RegistrationStatus',
} as const

type ColumnIndex = Record<keyof typeof COLUMNS, number> & { otherNames: number[] }

export function indexColumns(header: string[]): ColumnIndex {
  const find = (name: string): number => {
    const index = header.indexOf(name)
    if (index === -1) throw new Error(`GLEIF CSV is missing column ${name}`)
    return index
  }
  const fixed = Object.fromEntries(Object.entries(COLUMNS).map(([key, name]) => [key, find(name)])) as Record<keyof typeof COLUMNS, number>
  const otherNames = header.flatMap((name, index) => (OTHER_NAME_COLUMN.test(name) ? [index] : []))
  return { ...fixed, otherNames }
}

export function toGleifRecord(row: string[], columns: ColumnIndex): GleifRecord {
  const at = (index: number): string => (row[index] ?? '').trim()
  return {
    lei: at(columns.lei), legalName: at(columns.legalName),
    otherNames: columns.otherNames.map(at).filter((name) => name !== ''),
    legalCountry: at(columns.legalCountry), legalCity: at(columns.legalCity), hqCountry: at(columns.hqCountry), hqCity: at(columns.hqCity),
    jurisdiction: at(columns.jurisdiction), category: at(columns.category), legalForm: at(columns.legalForm),
    entityStatus: at(columns.entityStatus), registrationStatus: at(columns.registrationStatus),
  }
}

async function* recordsFromCsv(rows: AsyncIterable<string[]>): AsyncGenerator<GleifRecord> {
  let columns: ColumnIndex | undefined
  for await (const row of rows) {
    if (!columns) {
      columns = indexColumns(row)
      continue
    }
    const record = toGleifRecord(row, columns)
    if (record.lei !== '') yield record
  }
}

const fileSchema = z.object({ url: z.url(), record_count: z.number() })
const publishSchema = z.object({
  data: z.object({
    publish_date: z.string(),
    lei2: z.object({ full_file: z.object({ csv: fileSchema }), delta_files: z.object({ LastDay: z.object({ csv: fileSchema }) }) }),
  }),
})

const IDLE_TIMEOUT_MS = 30_000
export const TEMP_PREFIX = 'leadex-gleif-'

async function fetchJson(url: string, userAgent: string): Promise<unknown> {
  const response = await fetch(url, { headers: { 'user-agent': userAgent }, signal: AbortSignal.timeout(IDLE_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`GLEIF API failed: HTTP ${response.status} for ${url}`)
  return response.json()
}

export function createGleifRepository(apiUrl: string, userAgent: string): GleifSource {
  return {
    async latestPublish(): Promise<GleifPublish> {
      const body = publishSchema.parse(await fetchJson(apiUrl, userAgent))
      const { publish_date: publishDate, lei2 } = body.data
      return { publishDate: `${publishDate.replace(' ', 'T')}Z`, fullCsvUrl: lei2.full_file.csv.url, fullRecords: lei2.full_file.csv.record_count, lastDayCsvUrl: lei2.delta_files.LastDay.csv.url }
    },
    // Downloads the zip to a temporary file first, then imports from disk; the file is removed afterwards.
    async *streamRecords(zipUrl: string): AsyncGenerator<GleifRecord> {
      const dir = await mkdtemp(join(tmpdir(), TEMP_PREFIX))
      try {
        const file = join(dir, 'golden-copy.zip')
        const download = await downloadToFile(zipUrl, file, { userAgent, idleTimeoutMs: IDLE_TIMEOUT_MS, ...RETRY_POLICY })
        logInfo('gleif download finished', { url: zipUrl, ...download })
        // pipeline forwards zip and CSV errors to the parser we read, so the loop throws instead of hanging.
        const rows = pipeline(createReadStream(file), new FirstZipEntry(), createInflateRaw(), parse({ bom: true, relax_quotes: true }), () => {})
        try {
          yield* recordsFromCsv(rows)
        } finally {
          rows.destroy()
        }
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
  }
}
