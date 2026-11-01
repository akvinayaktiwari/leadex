// Imports GLEIF legal entities (#22 part 3): the full golden copy when none is recent, otherwise the last-day delta.
import { isAllowedCountry } from '../lib/countries.js'
import { legalNameKey } from '../lib/legal-names.js'
import { logInfo } from '../lib/logger.js'
import type {
  Clock, GleifImportKind, GleifPublish, GleifRecord, GleifSource, IngestJobResult, LegalEntitiesRepository, LegalEntityNameRow,
} from '../types/index.js'

const DAY_MS = 86_400_000

export interface GleifImportDeps {
  source: GleifSource
  entities: LegalEntitiesRepository
  clock: Clock
}

export interface GleifImportOptions {
  // A full file is imported when the last one is older than this (deltas fill the days in between).
  fullEveryDays: number
  batchSize: number
}

// Skipped only when neither the legal address nor the head office is outside the EU/EEA/UK.
export function isImportable(record: GleifRecord): boolean {
  return record.legalName !== '' && (isAllowedCountry(record.legalCountry) || isAllowedCountry(record.hqCountry))
}

export function nameRows(record: GleifRecord, publishDate: string): LegalEntityNameRow[] {
  const keys = new Set([record.legalName, ...record.otherNames].map(legalNameKey).filter((key) => key !== ''))
  const { lei, legalCountry, hqCountry, entityStatus, registrationStatus } = record
  return [...keys].map((nameKey) => ({ nameKey, lei, legalCountry, hqCountry, entityStatus, registrationStatus, publishDate }))
}

async function chooseFile(deps: GleifImportDeps, publish: GleifPublish, options: GleifImportOptions): Promise<{ kind: GleifImportKind; url: string } | undefined> {
  const lastFull = await deps.entities.latestImport('full')
  const fullIsStale = !lastFull || deps.clock.now().getTime() - Date.parse(lastFull.publishDate) > options.fullEveryDays * DAY_MS
  if (fullIsStale) return { kind: 'full', url: publish.fullCsvUrl }
  // A full file already contains its own day's changes.
  if (lastFull.publishDate === publish.publishDate || (await deps.entities.hasImport('delta', publish.publishDate))) return undefined
  return { kind: 'delta', url: publish.lastDayCsvUrl }
}

async function streamFile(deps: GleifImportDeps, url: string, publishDate: string, batchSize: number): Promise<IngestJobResult> {
  let entities: GleifRecord[] = []
  let names: LegalEntityNameRow[] = []
  let written = 0
  let skipped = 0
  const flush = async (): Promise<void> => {
    await deps.entities.insertNames(names)
    await deps.entities.insertEntities(entities, publishDate)
    written += entities.length
    entities = []
    names = []
  }
  for await (const record of deps.source.streamRecords(url)) {
    if (!isImportable(record)) {
      skipped += 1
      continue
    }
    entities.push(record)
    names.push(...nameRows(record, publishDate))
    if (entities.length >= batchSize) await flush()
  }
  await flush()
  return { written, skipped }
}

export async function importGleif(deps: GleifImportDeps, options: GleifImportOptions): Promise<IngestJobResult> {
  const publish = await deps.source.latestPublish()
  const file = await chooseFile(deps, publish, options)
  if (!file) {
    logInfo('gleif import skipped: already up to date', { publishDate: publish.publishDate })
    return { written: 0, skipped: 0 }
  }
  const result = await streamFile(deps, file.url, publish.publishDate, options.batchSize)
  // Recorded only after every row is in, so an interrupted import is redone on the next run (rows are replaced, not duplicated).
  await deps.entities.recordImport({ kind: file.kind, publishDate: publish.publishDate, records: result.written, importedAt: deps.clock.now().toISOString() })
  logInfo('gleif import finished', { kind: file.kind, publishDate: publish.publishDate, written: result.written, skipped: result.skipped })
  return result
}
