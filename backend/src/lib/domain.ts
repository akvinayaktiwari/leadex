// Turns user input ("Acme.com", "https://www.acme.com/pricing?x=1") into a bare registrable host ("acme.com").

const MAX_HOST_LENGTH = 253

// Hosts that can never be a public company website.
const NON_PUBLIC_SUFFIXES = ['.local', '.localhost', '.internal', '.lan', '.home', '.corp', '.test', '.example', '.invalid', '.onion']

export type DomainResult = { ok: true; domain: string } | { ok: false; reason: 'invalid_url' | 'unsupported_host' }

function toUrl(input: string): URL | undefined {
  const raw = input.trim()
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
  return URL.canParse(withScheme) ? new URL(withScheme) : undefined
}

function isIpLiteral(host: string): boolean {
  return host.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)
}

export function normalizeDomain(input: string): DomainResult {
  const url = toUrl(input)
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
    return { ok: false, reason: 'invalid_url' }
  }
  const host = url.hostname.replace(/\.$/, '')
  if (!host.includes('.') || host.length > MAX_HOST_LENGTH || isIpLiteral(host)) return { ok: false, reason: 'unsupported_host' }
  if (host === 'localhost' || NON_PUBLIC_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return { ok: false, reason: 'unsupported_host' }
  }
  return { ok: true, domain: host.replace(/^www\./, '') }
}

// Same site for crawling purposes: identical host, or the www / bare variant of it.
export function isSameSite(hostA: string, hostB: string): boolean {
  const bare = (host: string): string => host.toLowerCase().replace(/^www\./, '')
  return bare(hostA) === bare(hostB)
}
