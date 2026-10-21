import { lookup, type LookupAddress, type LookupAllOptions } from 'node:dns'
import { isIP, type LookupFunction } from 'node:net'
import { Agent, fetch, type Response } from 'undici'
import type { FetchFailure, FetchRequest, FetchResult, SiteFetchRepository } from '../types/index.js'

export interface SiteFetchOptions {
  userAgent: string
  maxBytes: number
  maxRedirects: number
  // Decides which resolved IPs may be contacted. Production passes isPublicAddress.
  isAllowedAddress: (address: string) => boolean
}

class BlockedHostError extends Error {
  constructor(host: string) {
    super(`Refusing to connect to non-public address for ${host}`)
    this.name = 'BlockedHostError'
  }
}

// Checked at connect time, so DNS rebinding between a check and the connection can't slip through.
function guardedLookup(isAllowedAddress: (address: string) => boolean): LookupFunction {
  return (hostname, options, callback) => {
    const allOptions: LookupAllOptions = { ...options, all: true }
    lookup(hostname, allOptions, (error, addresses: LookupAddress[]) => {
      if (error) return callback(error, '', 4)
      if (addresses.length === 0 || addresses.some((entry) => !isAllowedAddress(entry.address))) {
        return callback(new BlockedHostError(hostname), '', 4)
      }
      if (options.all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, addresses)
      const first = addresses[0] as LookupAddress
      return callback(null, first.address, first.family)
    })
  }
}

function failureFromError(error: unknown): FetchFailure {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    if (current instanceof BlockedHostError) return 'blocked_host'
    if (current.name === 'TimeoutError' || current.name === 'AbortError') return 'timeout'
  }
  return 'network'
}

function isAcceptedType(response: Response, accept: FetchRequest['accept']): boolean {
  const type = (response.headers.get('content-type') ?? '').toLowerCase()
  if (accept === 'html') return type.includes('text/html') || type.includes('application/xhtml')
  return type.startsWith('text/') || type === ''
}

async function readCapped(response: Response, maxBytes: number): Promise<string | undefined> {
  if (!response.body) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.byteLength
    if (size > maxBytes) return undefined
    chunks.push(chunk)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

function isPermittedUrl(url: URL, options: SiteFetchOptions): boolean {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  const host = url.hostname.replace(/^\[|\]$/g, '')
  // IP literals skip DNS, so the lookup guard never sees them; check them here.
  return isIP(host) === 0 || options.isAllowedAddress(host)
}

async function fetchFollowingRedirects(request: FetchRequest, options: SiteFetchOptions, dispatcher: Agent): Promise<FetchResult> {
  const signal = AbortSignal.timeout(request.timeoutMs)
  let url = new URL(request.url)
  for (let hop = 0; hop <= options.maxRedirects; hop += 1) {
    if (!isPermittedUrl(url, options)) return { ok: false, reason: 'blocked_host' }
    const response = await fetch(url, { dispatcher, signal, redirect: 'manual', headers: { 'user-agent': options.userAgent, accept: request.accept === 'html' ? 'text/html' : 'text/plain' } })
    const location = response.headers.get('location')
    if (response.status >= 300 && response.status < 400 && location && URL.canParse(location, url)) {
      await response.body?.cancel()
      url = new URL(location, url)
      continue
    }
    if (!response.ok) return { ok: false, reason: 'http_error', status: response.status }
    if (!isAcceptedType(response, request.accept)) return { ok: false, reason: 'unsupported_type', status: response.status }
    const body = await readCapped(response, options.maxBytes)
    if (body === undefined) return { ok: false, reason: 'too_large', status: response.status }
    return { ok: true, finalUrl: url.href, status: response.status, body }
  }
  return { ok: false, reason: 'http_error' }
}

export function createSiteFetchRepository(options: SiteFetchOptions): SiteFetchRepository {
  const dispatcher = new Agent({ connect: { lookup: guardedLookup(options.isAllowedAddress) } })
  return {
    async fetchText(request: FetchRequest): Promise<FetchResult> {
      try {
        return await fetchFollowingRedirects(request, options, dispatcher)
      } catch (error) {
        // Network-level failures are an expected outcome for crawling; the caller decides what they mean.
        return { ok: false, reason: failureFromError(error) }
      }
    },
  }
}
