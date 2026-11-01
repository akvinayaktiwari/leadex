// Streams a large public file, surviving network stalls: if no bytes arrive for idleTimeoutMs while we are
// waiting for the network, the request is aborted and resumed with an HTTP Range request from the byte reached.
import { logInfo } from '../lib/logger.js'

export interface DownloadOptions {
  userAgent: string
  // Time allowed waiting for the next chunk from the network. Time the caller spends between reads does not count.
  idleTimeoutMs: number
  maxRetries: number
  signal?: AbortSignal | undefined
}

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

async function readWithTimeout(reader: ReadableStreamDefaultReader<Uint8Array>, controller: AbortController, url: string, idleTimeoutMs: number): Promise<ReadableStreamReadResult<Uint8Array>> {
  let stalled = false
  const timer = setTimeout(() => {
    stalled = true
    controller.abort()
  }, idleTimeoutMs)
  try {
    return await reader.read()
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
    const reader = await open(url, offset, options, controller.signal)
    for (;;) {
      const { done, value } = await readWithTimeout(reader, controller, url, options.idleTimeoutMs)
      if (done) return
      onBytes(value.length)
      yield value
    }
  } finally {
    options.signal?.removeEventListener('abort', abortOnOuter)
    controller.abort()
  }
}

const isRetryable = (error: unknown): boolean => error instanceof StallError || (error instanceof TypeError && /fetch failed|terminated|socket/i.test(String(error.message) + String((error as { cause?: unknown }).cause ?? '')))

export async function* resumableDownload(url: string, options: DownloadOptions): AsyncGenerator<Uint8Array> {
  let offset = 0
  for (let attempt = 0; ; attempt += 1) {
    try {
      yield* streamFrom(url, offset, options, (count) => {
        offset += count
      })
      return
    } catch (error) {
      if (options.signal?.aborted || attempt >= options.maxRetries || !isRetryable(error)) throw error
      logInfo('download interrupted, resuming', { url, offset, attempt: attempt + 1, reason: error instanceof Error ? error.message : String(error) })
    }
  }
}
