// Streams a large public file, surviving network stalls: if no bytes arrive for idleTimeoutMs while we are
// waiting for the network, the request is aborted and resumed with an HTTP Range request from the byte reached.
import { logInfo } from '../lib/logger.js'

export interface DownloadOptions {
  userAgent: string
  // Time allowed waiting for the next chunk from the network. Time the caller spends between reads does not count.
  idleTimeoutMs: number
  // Interruptions in a row with no new bytes before giving up.
  maxRetries: number
  // Wait before each resume: retryBaseMs, doubling per interruption in a row, capped at retryMaxMs. Without it a short
  // outage (Wi-Fi, laptop sleep) used up every retry within milliseconds.
  retryBaseMs: number
  retryMaxMs: number
  signal?: AbortSignal | undefined
}

// Production retry policy: 8 interruptions in a row, waiting 1, 2, 4 … up to 60 s between them (about 3 minutes in all).
export const RETRY_POLICY: Pick<DownloadOptions, 'maxRetries' | 'retryBaseMs' | 'retryMaxMs'> = { maxRetries: 8, retryBaseMs: 1_000, retryMaxMs: 60_000 }

class StallError extends Error {
  constructor(url: string, idleTimeoutMs: number) {
    super(`No data from ${url} for ${idleTimeoutMs} ms`)
    this.name = 'StallError'
  }
}

async function open(url: string, offset: number, options: DownloadOptions, signal: AbortSignal): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const headers: Record<string, string> = { 'user-agent': options.userAgent, ...(offset > 0 ? { range: `bytes=${offset}-` } : {}) }
  const response = await fetch(url, { headers, signal })
  if (offset > 0 && response.status !== 206) {
    // Continuing from a full response would duplicate the start of the file into the stream.
    throw new Error(`Cannot resume ${url}: the server answered ${response.status} to a range request`)
  }
  if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status} for ${url}`)
  return response.body.getReader()
}

// Aborts `work` if it doesn't settle within idleTimeoutMs, reporting a stall. Used both while waiting for the
// response headers (a server can accept the connection and never answer) and for every body read.
async function withStallTimeout<T>(work: () => Promise<T>, controller: AbortController, url: string, idleTimeoutMs: number): Promise<T> {
  let stalled = false
  const timer = setTimeout(() => {
    stalled = true
    controller.abort()
  }, idleTimeoutMs)
  try {
    return await work()
  } catch (error) {
    throw stalled ? new StallError(url, idleTimeoutMs) : error
  } finally {
    clearTimeout(timer)
  }
}

// One connection's worth of bytes; returns normally only when the file is complete.
async function* streamFrom(url: string, offset: number, options: DownloadOptions, onBytes: (count: number) => void): AsyncGenerator<Uint8Array> {
  const controller = new AbortController()
  const abortOnOuter = (): void => controller.abort()
  options.signal?.addEventListener('abort', abortOnOuter)
  try {
    const reader = await withStallTimeout(() => open(url, offset, options, controller.signal), controller, url, options.idleTimeoutMs)
    for (;;) {
      const { done, value } = await withStallTimeout(() => reader.read(), controller, url, options.idleTimeoutMs)
      if (done) return
      onBytes(value.length)
      yield value
    }
  } finally {
    options.signal?.removeEventListener('abort', abortOnOuter)
    controller.abort()
  }
}

// Resolves after ms, or rejects at once if the download is cancelled meanwhile.
function waitBeforeRetry(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

const retryDelayMs = (options: DownloadOptions, failuresInARow: number): number =>
  Math.min(options.retryMaxMs, options.retryBaseMs * 2 ** (failuresInARow - 1))

const isRetryable = (error: unknown): boolean => error instanceof StallError || (error instanceof TypeError && /fetch failed|terminated|socket/i.test(String(error.message) + String((error as { cause?: unknown }).cause ?? '')))

// maxRetries counts interruptions in a row without new data: a long download on a flaky link that keeps making
// progress is never given up (a full GLEIF import stalled 6 times in 94 minutes and failed under a total cap).
export async function* resumableDownload(url: string, options: DownloadOptions): AsyncGenerator<Uint8Array> {
  let offset = 0
  let failures = 0
  let offsetAtLastFailure = 0
  for (;;) {
    try {
      yield* streamFrom(url, offset, options, (count) => {
        offset += count
      })
      return
    } catch (error) {
      if (offset > offsetAtLastFailure) failures = 0
      failures += 1
      offsetAtLastFailure = offset
      if (options.signal?.aborted || failures > options.maxRetries || !isRetryable(error)) throw error
      const delayMs = retryDelayMs(options, failures)
      logInfo('download interrupted, resuming', { url, offset, failuresInARow: failures, delayMs, reason: error instanceof Error ? error.message : String(error) })
      await waitBeforeRetry(delayMs, options.signal)
    }
  }
}
