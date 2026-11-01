// Imports the ranked domain universe from the Common Crawl domain-level web graph (#22 part 1).
import { commonCrawlRelease, rejectDomain, tldOf, unreverseDomain, type DomainRejection } from '../lib/domain-filters.js'
import { logInfo } from '../lib/logger.js'
import type {
  Clock,
  DomainCandidate,
  DomainCandidatesRepository,
  DomainImportOptions,
  DomainRankLine,
  DomainRanksSource,
  IngestJobResult,
} from '../types/index.js'

export interface DomainImportDeps {
  source: DomainRanksSource
  candidates: DomainCandidatesRepository
  clock: Clock
}

type Converted = { ok: true; candidate: DomainCandidate } | { ok: false; reason: DomainRejection }

export function toCandidate(line: DomainRankLine, release: string, importedAt: string): Converted {
  const domain = unreverseDomain(line.reversedDomain)
  const reason = rejectDomain(domain)
  if (reason) return { ok: false, reason }
  const { harmonicRank, harmonicValue, pagerankRank, hosts } = line
  return { ok: true, candidate: { domain, tld: tldOf(domain), harmonicRank, harmonicValue, pagerankRank, hosts, release, importedAt } }
}

async function streamIntoBatches(deps: DomainImportDeps, options: DomainImportOptions, release: string): Promise<IngestJobResult> {
  const importedAt = deps.clock.now().toISOString()
  const skippedBy: Record<DomainRejection, number> = { invalid: 0, blocked_tld: 0, non_company: 0 }
  let batch: DomainCandidate[] = []
  let written = 0
  for await (const line of deps.source.streamDomainRanks(options.url)) {
    const converted = toCandidate(line, release, importedAt)
    if (!converted.ok) {
      skippedBy[converted.reason] += 1
      continue
    }
    batch.push(converted.candidate)
    if (batch.length >= options.batchSize || written + batch.length >= options.maxDomains) {
      await deps.candidates.insertCandidates(batch)
      written += batch.length
      batch = []
      if (written >= options.maxDomains) break
    }
  }
  await deps.candidates.insertCandidates(batch)
  written += batch.length
  logInfo('domain import finished', { release, written, ...skippedBy })
  return { written, skipped: skippedBy.invalid + skippedBy.blocked_tld + skippedBy.non_company }
}

// Re-running for a release that already holds maxDomains rows does nothing, so the daily schedule
// downloads each quarterly release once. A partial import is redone from the top (rows are replaced, not duplicated).
export async function importDomainRanks(deps: DomainImportDeps, options: DomainImportOptions): Promise<IngestJobResult> {
  const release = commonCrawlRelease(options.url)
  if (!release) throw new Error(`Cannot tell the Common Crawl release from ${options.url}`)
  const existing = await deps.candidates.countForRelease(release)
  if (existing >= options.maxDomains) {
    logInfo('domain import skipped: release already imported', { release, existing })
    return { written: 0, skipped: 0 }
  }
  return streamIntoBatches(deps, options, release)
}
