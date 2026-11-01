import { Readable, pipeline } from 'node:stream'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { createGunzip } from 'node:zlib'
import type { DomainRankLine, DomainRanksSource } from '../types/index.js'

// Columns of the domain-ranks file (tab-separated, header lines start with "#"):
// #harmonicc_pos  #harmonicc_val  #pr_pos  #pr_val  #host_rev  #n_hosts
export function parseDomainRankLine(line: string): DomainRankLine | undefined {
  if (line.startsWith('#') || line.trim() === '') return undefined
  const [hcPos, hcVal, prPos, , reversed, hosts] = line.split('\t')
  const parsed = {
    harmonicRank: Number(hcPos),
    harmonicValue: Number(hcVal),
    pagerankRank: Number(prPos),
    reversedDomain: reversed ?? '',
    hosts: Number(hosts),
  }
  const numbersOk = [parsed.harmonicRank, parsed.harmonicValue, parsed.pagerankRank, parsed.hosts].every(Number.isFinite)
  return numbersOk && parsed.reversedDomain !== '' ? parsed : undefined
}

async function* splitLines(chunks: AsyncIterable<Buffer>): AsyncGenerator<string> {
  let rest = ''
  for await (const chunk of chunks) {
    const parts = (rest + chunk.toString('utf8')).split('\n')
    rest = parts.pop() ?? ''
    yield* parts
  }
  if (rest !== '') yield rest
}

async function* readGzipLines(url: string, userAgent: string, signal: AbortSignal): AsyncGenerator<string> {
  const response = await fetch(url, { headers: { 'user-agent': userAgent }, signal })
  if (!response.ok || !response.body) throw new Error(`Common Crawl download failed: HTTP ${response.status} for ${url}`)
  const source = Readable.fromWeb(response.body as WebReadableStream<Uint8Array>)
  // pipeline forwards a download or gzip error to the stream we read, so the loop throws instead of hanging.
  const gunzip = pipeline(source, createGunzip(), () => {})
  try {
    yield* splitLines(gunzip)
  } finally {
    gunzip.destroy()
  }
}

export function createCommonCrawlRepository(userAgent: string): DomainRanksSource {
  return {
    async *streamDomainRanks(url: string): AsyncGenerator<DomainRankLine> {
      // Aborting stops the HTTP transfer when the caller breaks out early (it only needs the top N).
      const controller = new AbortController()
      try {
        for await (const line of readGzipLines(url, userAgent, controller.signal)) {
          const parsed = parseDomainRankLine(line)
          if (parsed) yield parsed
        }
      } finally {
        controller.abort()
      }
    },
  }
}
