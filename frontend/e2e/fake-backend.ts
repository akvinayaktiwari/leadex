// E2E fake backend: serves the built static site (out/), POST /api/analyses and the run-event stream on one origin.
// One stream connection is cut after a few events to simulate a network drop; every resume repeats the last event the
// client already has, to prove the page applies each event once.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.E2E_PORT ?? 4310)
const OUT_DIR = fileURLToPath(new URL('../out/', import.meta.url))
const TS = '2026-11-02T10:00:00.000Z'
const RUN_ID = 'run_e2e'

const segment = (id: string, name: string, sharePct: number) => ({
  segmentId: id, name, useCase: 'Generate site visits', pain: 'Leads that never visit', criteria: ['Active project', 'Runs ads'], buyerTitles: ['Marketing Head', 'Director'], sharePct,
  filters: { industries: ['real_estate'], employeeMin: 10, employeeMax: 200, countries: ['IN'], keywords: [], technologies: [] },
})

const EVENTS = [
  { kind: 'step', step: 'crawl', state: 'started', label: 'Reading the website' },
  { kind: 'agent_note', text: 'Read 6 pages from qdnco.com' },
  { kind: 'step', step: 'crawl', state: 'completed', label: 'Reading the website', durationMs: 1800 },
  { kind: 'step', step: 'profile', state: 'started', label: 'Working out what the business sells' },
  { kind: 'artifact', step: 'profile', artifact: 'profile', data: {
    domain: 'qdnco.com', name: 'QD & Co.', oneLiner: 'Real estate performance marketing', valueProps: ['AI ad creatives'], category: 'real estate marketing agency',
    pricingSignals: [], servedMarkets: ['IN', 'AE'], crawledAt: TS,
    claims: [{ field: 'oneLiner', text: 'Real estate performance marketing', sourceUrl: 'https://qdnco.com/' }, { field: 'valueProp', text: 'AI ad creatives', sourceUrl: 'https://qdnco.com/services' }],
  } },
  { kind: 'step', step: 'profile', state: 'completed', label: 'Working out what the business sells', durationMs: 4100 },
  { kind: 'step', step: 'competitors', state: 'started', label: 'Finding competitors in your markets' },
  { kind: 'artifact', step: 'competitors', artifact: 'competitor', data: { domain: 'xionmedia.in', name: 'Xion Media', reason: 'Real estate ads in India', country: 'IN', countrySource: 'cctld' } },
  { kind: 'step', step: 'competitors', state: 'completed', label: 'Finding competitors in your markets', durationMs: 3000 },
  { kind: 'step', step: 'segments', state: 'started', label: 'Finding who buys from you' },
  { kind: 'artifact', step: 'segments', artifact: 'segment', data: segment('villa', 'Villa developers', 35) },
  { kind: 'artifact', step: 'segments', artifact: 'segment', data: segment('plots', 'Plotted developers', 25) },
  { kind: 'artifact', step: 'segments', artifact: 'segment', data: segment('brokers', 'Brokerage firms', 25) },
  { kind: 'artifact', step: 'segments', artifact: 'segment', data: segment('commercial', 'Commercial developers', 15) },
  { kind: 'step', step: 'segments', state: 'completed', label: 'Finding who buys from you', durationMs: 6000 },
  { kind: 'end', status: 'done' },
].map((event, index) => ({ ...event, seq: index + 1, ts: TS }))

const DROP_AFTER_SEQ = 8
const streamRequests: { lastEventId: string | undefined; after: string | null }[] = []
const analysisBodies: unknown[] = []
let dropped = false

function cors(response: ServerResponse): void {
  response.setHeader('access-control-allow-origin', `http://127.0.0.1:${PORT}`)
  response.setHeader('access-control-allow-credentials', 'true')
  response.setHeader('access-control-allow-headers', 'content-type')
}

function frame(event: (typeof EVENTS)[number]): string {
  return `id: ${event.seq}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`
}

// Cuts the connection mid-run once. Counts only if the page was still listening: the page may close a stream itself
// when its effect re-runs, and that is not a network drop.
function dropAfterDelay(response: ServerResponse): void {
  let clientClosed = false
  response.on('close', () => { clientClosed = true })
  setTimeout(() => {
    if (clientClosed) return
    dropped = true
    response.destroy()
  }, 150)
}

// Resumes from the client's position like the real backend, but on purpose repeats the event before it.
function stream(request: IncomingMessage, response: ServerResponse, url: URL): void {
  const lastEventId = request.headers['last-event-id'] as string | undefined
  const after = url.searchParams.get('after')
  streamRequests.push({ lastEventId, after })
  const resumeAfter = Number(lastEventId ?? after ?? 0)
  const from = Math.max(1, resumeAfter)
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
  response.write('retry: 300\n\n')
  const cut = !dropped && from <= DROP_AFTER_SEQ
  for (const event of EVENTS.filter((e) => e.seq >= from && (!cut || e.seq <= DROP_AFTER_SEQ))) response.write(frame(event))
  if (cut) return dropAfterDelay(response)
  response.end()
}

function startAnalysis(request: IncomingMessage, response: ServerResponse): void {
  let body = ''
  request.on('data', (chunk: Buffer) => { body += chunk.toString() })
  request.on('end', () => {
    analysisBodies.push(JSON.parse(body))
    response.writeHead(202, { 'content-type': 'application/json' }).end(JSON.stringify({ runId: RUN_ID, domain: 'qdnco.com', cached: false }))
  })
}

async function serveStatic(response: ServerResponse, pathname: string): Promise<void> {
  const clean = normalize(pathname).replace(/^(\.\.[/\\])+/, '')
  const candidates = clean.endsWith('/') ? [join(clean, 'index.html')] : [clean, `${clean}.html`]
  for (const candidate of candidates) {
    try {
      const body = await readFile(join(OUT_DIR, candidate))
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.txt': 'text/plain' }[extname(candidate)] ?? 'application/octet-stream'
      response.writeHead(200, { 'content-type': type }).end(body)
      return
    } catch {
      // Not this candidate; try the next one.
    }
  }
  response.writeHead(404).end('not found')
}

createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${PORT}`)
  cors(response)
  if (request.method === 'OPTIONS') return void response.writeHead(204).end()
  if (url.pathname === '/api/analyses' && request.method === 'POST') return void startAnalysis(request, response)
  if (url.pathname === `/api/runs/${RUN_ID}/events`) return stream(request, response, url)
  if (url.pathname === '/__e2e/analysis-bodies') return void response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(analysisBodies))
  if (url.pathname === '/__e2e/stream-requests') return void response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(streamRequests))
  void serveStatic(response, url.pathname)
}).listen(PORT, '127.0.0.1', () => console.log(`fake backend on http://127.0.0.1:${PORT}`))
