import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { gzipSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { commonCrawlRelease, rejectDomain, unreverseDomain } from '../src/lib/domain-filters.js'
import { createCommonCrawlRepository, parseDomainRankLine } from '../src/repositories/common-crawl-repository.js'
import { importDomainRanks } from '../src/services/domain-import-service.js'
import type { DomainCandidate, DomainCandidatesRepository, DomainRankLine, DomainRanksSource } from '../src/types/index.js'
import { manualClock } from './support/in-memory-run-store.js'

const URL_ = 'https://data.commoncrawl.org/projects/hyperlinkgraph/cc-main-2026-apr-may-jun/domain/cc-main-2026-apr-may-jun-domain-ranks.txt.gz'
const HEADER = '#harmonicc_pos\t#harmonicc_val\t#pr_pos\t#pr_val\t#host_rev\t#n_hosts'

function rankLine(rank: number, reversed: string): string {
  return `${rank}\t${(1000 - rank).toFixed(1)}E3\t${rank + 1}\t0.001\t${reversed}\t${rank}`
}

describe('domain filters', () => {
  // protects=reversed graph names map back to real domains, including multi-label public suffixes;
  // fails_when="uk.co.bbc" becomes "co.uk.bbc" or case survives;
  // no_claim=does not resolve public suffixes beyond the reversal.
  it('unreverses domains', () => {
    expect(unreverseDomain('com.Example')).toBe('example.com')
    expect(unreverseDomain('in.co.tata')).toBe('tata.co.in')
  })

  // protects=EU/EEA/UK ccTLDs, .eu, and public-sector suffixes are never imported; ordinary company domains are;
  // fails_when=a .de or .co.uk domain, gov.in or an .edu is accepted, or a .com/.co.in/.ai company is rejected;
  // no_claim=a .com company located in the EU passes here; the profiler's country check (Leadex Data service) stops it.
  it('rejects blocked and non-company domains', () => {
    for (const domain of ['siemens.de', 'bbc.co.uk', 'europa.eu', 'example.no']) expect(rejectDomain(domain), domain).toBe('blocked_tld')
    for (const domain of ['nasa.gov', 'mit.edu', 'india.gov.in', 'iitb.ac.in', 'unsw.edu.au']) expect(rejectDomain(domain), domain).toBe('non_company')
    for (const domain of ['-bad.com', 'localhost', 'a..b']) expect(rejectDomain(domain), domain).toBe('invalid')
    for (const domain of ['acme.com', 'tata.co.in', 'mistral.ai', 'noon.ae']) expect(rejectDomain(domain), domain).toBeUndefined()
  })

  // protects=the release name comes from the URL path, so each quarterly file is imported once;
  // fails_when=a URL without the hyperlinkgraph path is accepted with a made-up release;
  // no_claim=n/a.
  it('reads the release from the URL', () => {
    expect(commonCrawlRelease(URL_)).toBe('cc-main-2026-apr-may-jun')
    expect(commonCrawlRelease('https://example.com/ranks.txt.gz')).toBeUndefined()
  })

  // protects=rank lines parse into numbers, while headers, blanks and malformed lines are dropped;
  // fails_when=the header row becomes a domain or a non-numeric rank becomes NaN in ClickHouse;
  // no_claim=fixture lines; the real file's first lines were checked by hand on 2026-11-01.
  it('parses rank lines', () => {
    expect(parseDomainRankLine('1\t2.9799486E7\t1\t0.016263289315696608\tcom.googleapis\t2920')).toEqual({
      harmonicRank: 1, harmonicValue: 29799486, pagerankRank: 1, reversedDomain: 'com.googleapis', hosts: 2920,
    })
    expect(parseDomainRankLine(HEADER)).toBeUndefined()
    expect(parseDomainRankLine('x\t1\t1\t0\tcom.a\t1')).toBeUndefined()
    expect(parseDomainRankLine('')).toBeUndefined()
  })
})

function memorySource(lines: DomainRankLine[]): DomainRanksSource & { read: number; closed: boolean } {
  const state = { read: 0, closed: false }
  return Object.assign(state, {
    async *streamDomainRanks(): AsyncGenerator<DomainRankLine> {
      try {
        for (const line of lines) {
          state.read += 1
          yield line
        }
      } finally {
        state.closed = true
      }
    },
  })
}

function memoryCandidates(existing = 0): DomainCandidatesRepository & { batches: DomainCandidate[][] } {
  const batches: DomainCandidate[][] = []
  return {
    batches,
    async insertCandidates(rows: DomainCandidate[]) { if (rows.length > 0) batches.push(rows) },
    async countForRelease() { return existing },
  }
}

const lines = (reversed: string[]): DomainRankLine[] => reversed.map((domain, index) => parseDomainRankLine(rankLine(index + 1, domain))!)

describe('domain import service', () => {
  // protects=the import keeps exactly the top N accepted domains in rank order, in batches, and stops reading
  // (closing the download) once it has them;
  // fails_when=rejected domains count toward N, the last partial batch is lost, or the whole 2.2 GB file is read for N=3;
  // no_claim=memory source; the HTTP streaming and early close are tested against a local server below.
  it('imports the top N accepted domains and stops early', async () => {
    const source = memorySource(lines(['com.a', 'de.siemens', 'com.b', 'gov.nasa', 'com.c', 'com.d', 'com.e']))
    const candidates = memoryCandidates()
    const result = await importDomainRanks({ source, candidates, clock: manualClock() }, { url: URL_, maxDomains: 3, batchSize: 2 })
    expect(candidates.batches.map((batch) => batch.map((row) => row.domain))).toEqual([['a.com', 'b.com'], ['c.com']])
    expect(result).toEqual({ written: 3, skipped: 2 })
    expect(source.read).toBe(5)
    expect(source.closed).toBe(true)
    expect(candidates.batches[0]?.[0]).toMatchObject({ release: 'cc-main-2026-apr-may-jun', harmonicRank: 1, tld: 'com' })
  })

  // protects=a release already imported to N rows is not downloaded again by the daily schedule;
  // fails_when=every daily run re-streams the 2.2 GB file;
  // no_claim=a partially imported release is redone from the top (rows replaced, not duplicated: see ClickHouse test).
  it('skips a release that is already imported', async () => {
    const source = memorySource(lines(['com.a']))
    const result = await importDomainRanks({ source, candidates: memoryCandidates(3), clock: manualClock() }, { url: URL_, maxDomains: 3, batchSize: 2 })
    expect(result).toEqual({ written: 0, skipped: 0 })
    expect(source.read).toBe(0)
  })

  // protects=a URL that doesn't name a Common Crawl release is refused before any download;
  // fails_when=rows are stored under an unknown release;
  // no_claim=n/a.
  it('refuses a URL without a release', async () => {
    const source = memorySource([])
    await expect(importDomainRanks({ source, candidates: memoryCandidates(), clock: manualClock() }, { url: 'https://example.com/r.gz', maxDomains: 1, batchSize: 1 })).rejects.toThrow(/release/)
  })
})

describe('Common Crawl repository (local HTTP server)', () => {
  const body = gzipSync(Buffer.from([HEADER, ...Array.from({ length: 50_000 }, (_, i) => rankLine(i + 1, `com.site${i}`))].join('\n')))
  let server: Server
  let base = ''
  const closedEarly: boolean[] = []

  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.url === '/missing') {
        response.writeHead(404).end()
        return
      }
      if (request.url === '/broken') {
        response.writeHead(200, { 'content-type': 'application/gzip' })
        // Cut the connection shortly after the first chunk, so the failure lands mid-file.
        response.write(body.subarray(0, 20_000), () => setTimeout(() => response.destroy(), 50))
        return
      }
      response.on('close', () => closedEarly.push(!response.writableFinished))
      response.writeHead(200, { 'content-type': 'application/gzip' })
      // Send slowly in chunks so an early stop happens before the body is complete.
      let offset = 0
      const timer = setInterval(() => {
        if (response.destroyed) return clearInterval(timer)
        response.write(body.subarray(offset, offset + 4096))
        offset += 4096
        if (offset >= body.length) {
          clearInterval(timer)
          response.end()
        }
      }, 1)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  // protects=the gzip stream is parsed line by line in order, and breaking out early aborts the transfer;
  // fails_when=the header is yielded, lines arrive out of order, or the client keeps downloading after the caller stops;
  // no_claim=does not hit data.commoncrawl.org.
  it('streams parsed lines and aborts the download on early exit', async () => {
    const repository = createCommonCrawlRepository('test-agent')
    const seen: string[] = []
    for await (const line of repository.streamDomainRanks(`${base}/ranks.txt.gz`)) {
      seen.push(line.reversedDomain)
      if (seen.length === 3) break
    }
    expect(seen).toEqual(['com.site0', 'com.site1', 'com.site2'])
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(closedEarly).toEqual([true])
  })

  // protects=a connection dropped mid-file fails the job (the error reaches the loop) instead of hanging or
  // reporting a short import as success;
  // fails_when=the gzip/HTTP error is lost between streams and the loop waits forever or ends normally;
  // no_claim=does not retry; the next scheduled run redoes the release.
  it('fails when the download breaks mid-file', async () => {
    const repository = createCommonCrawlRepository('test-agent')
    const consume = async (): Promise<void> => {
      for await (const _ of repository.streamDomainRanks(`${base}/broken`)) void _
    }
    await expect(consume()).rejects.toThrow()
  }, 10_000)

  // protects=an HTTP error fails the job instead of importing nothing silently;
  // fails_when=a 404 yields zero lines and the job reports success;
  // no_claim=n/a.
  it('fails on HTTP errors', async () => {
    const repository = createCommonCrawlRepository('test-agent')
    const consume = async (): Promise<void> => {
      for await (const _ of repository.streamDomainRanks(`${base}/missing`)) void _
    }
    await expect(consume()).rejects.toThrow(/HTTP 404/)
  })
})
