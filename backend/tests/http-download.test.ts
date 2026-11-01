import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resumableDownload } from '../src/repositories/http-download.js'

const FILE = Buffer.from(Array.from({ length: 200_000 }, (_, i) => String.fromCharCode(97 + (i % 26))).join(''))
const OPTIONS = { userAgent: 'test', idleTimeoutMs: 150, maxRetries: 3 }

type Route = (request: IncomingMessage, response: ServerResponse, requestNumber: number) => void

function rangeStart(request: IncomingMessage): number {
  return Number(/bytes=(\d+)-/.exec(request.headers.range ?? '')?.[1] ?? 0)
}

// Sends FILE from the requested range, in 16 KB chunks; optionally stops mid-way and holds the socket open (a stall).
function serve(response: ServerResponse, start: number, stallAfter?: number): void {
  response.writeHead(start > 0 ? 206 : 200, start > 0 ? { 'content-range': `bytes ${start}-${FILE.length - 1}/${FILE.length}` } : {})
  const end = stallAfter === undefined ? FILE.length : Math.min(FILE.length, start + stallAfter)
  for (let offset = start; offset < end; offset += 16_384) response.write(FILE.subarray(offset, Math.min(end, offset + 16_384)))
  if (stallAfter === undefined) response.end()
}

describe('resumable download (local HTTP server)', () => {
  let server: Server
  let base = ''
  const routes: Record<string, Route> = {}
  const counts: Record<string, number> = {}

  beforeAll(async () => {
    server = createServer((request, response) => {
      const path = request.url ?? ''
      counts[path] = (counts[path] ?? 0) + 1
      routes[path]?.(request, response, counts[path] ?? 1)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  async function download(path: string, consumerDelayMs = 0): Promise<Buffer> {
    const chunks: Uint8Array[] = []
    for await (const chunk of resumableDownload(`${base}${path}`, OPTIONS)) {
      chunks.push(chunk)
      if (consumerDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, consumerDelayMs))
    }
    return Buffer.concat(chunks)
  }

  // protects=a download that stalls mid-file (socket open, no bytes) is aborted after the idle timeout and resumed from the
  // exact byte reached, producing the file exactly once;
  // fails_when=the client waits forever (the GLEIF import hang seen on 2026-11-01), restarts from byte 0, or skips/duplicates bytes;
  // no_claim=does not cover servers that change the file between requests.
  it('resumes a stalled download from the byte reached', async () => {
    routes['/stall'] = (request, response, n) => serve(response, rangeStart(request), n === 1 ? 70_000 : undefined)
    expect((await download('/stall')).equals(FILE)).toBe(true)
    expect(counts['/stall']).toBe(2)
  })

  // protects=time the caller spends between reads (e.g. a slow database insert) is not counted as a stall;
  // fails_when=a slow consumer triggers false timeouts and endless resumes;
  // no_claim=n/a.
  it('does not count slow consumers as stalls', async () => {
    routes['/slow-consumer'] = (request, response) => serve(response, rangeStart(request))
    expect((await download('/slow-consumer', 200)).equals(FILE)).toBe(true)
    expect(counts['/slow-consumer']).toBe(1)
  })

  // protects=a server that ignores the range and resends from the start is refused rather than corrupting the stream;
  // fails_when=the start of the file is appended again after the bytes already read;
  // no_claim=n/a.
  it('refuses to resume from a server without range support', async () => {
    routes['/no-range'] = (_request, response, n) => serve(response, 0, n === 1 ? 70_000 : undefined)
    await expect(download('/no-range')).rejects.toThrow(/Cannot resume.*200/)
  })

  // protects=a server that keeps stalling fails the job after maxRetries instead of retrying forever;
  // fails_when=the ingest task hangs or loops without end;
  // no_claim=n/a.
  it('gives up after the retry limit', async () => {
    routes['/always-stalls'] = (request, response) => serve(response, rangeStart(request), 10_000)
    await expect(download('/always-stalls')).rejects.toThrow(/No data .* for 150 ms/)
    expect(counts['/always-stalls']).toBe(OPTIONS.maxRetries + 1)
  })
})
