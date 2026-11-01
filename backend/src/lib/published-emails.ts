// Finds email addresses a page publishes, including common anti-scraping encodings. Never invents an address.
import { load } from 'cheerio'
import type { FoundEmail } from '../types/index.js'

// Role mailboxes: a company-level contact, not a person.
const GENERAL_LOCAL_PARTS = new Set([
  'info', 'hello', 'hi', 'contact', 'contactus', 'office', 'admin', 'enquiries', 'enquiry', 'inquiries', 'inquiry', 'sales',
  'support', 'help', 'team', 'mail', 'email', 'general', 'reception', 'bookings', 'booking', 'business', 'marketing', 'hr',
  'careers', 'jobs', 'accounts', 'billing', 'press', 'media', 'partners', 'service', 'customerservice', 'owner',
])
// Never contacts: automated or legal addresses.
const IGNORED_LOCAL_PARTS = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|abuse|privacy|gdpr|dpo|legal|webmaster|hostmaster|unsubscribe|bounce)/
const EMAIL = /\b[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+\b/gi
const OBFUSCATED = /\b([a-z0-9._%+-]{1,64})\s*[[(]\s*at\s*[\])]\s*([a-z0-9-]{1,63}(?:\s*[[(]\s*dot\s*[\])]\s*[a-z0-9-]{1,63})+)\b/gi
const IMAGE_SUFFIX = /\.(png|jpe?g|gif|svg|webp)$/i

// Cloudflare email protection: hex string whose first byte is the XOR key.
export function decodeCloudflareEmail(encoded: string): string | undefined {
  if (!/^[0-9a-f]{4,}$/i.test(encoded) || encoded.length % 2 !== 0) return undefined
  const key = parseInt(encoded.slice(0, 2), 16)
  let out = ''
  for (let i = 2; i < encoded.length; i += 2) out += String.fromCharCode(parseInt(encoded.slice(i, i + 2), 16) ^ key)
  return out.includes('@') ? out : undefined
}

function candidates(html: string): string[] {
  const $ = load(html)
  const found: string[] = []
  $('a[href^="mailto:" i]').each((_, el) => { found.push(decodeURIComponent(($(el).attr('href') ?? '').slice(7).split('?')[0] ?? '')) })
  $('[data-cfemail]').each((_, el) => { found.push(decodeCloudflareEmail($(el).attr('data-cfemail') ?? '') ?? '') })
  $('a[href*="/cdn-cgi/l/email-protection#"]').each((_, el) => { found.push(decodeCloudflareEmail(($(el).attr('href') ?? '').split('#')[1] ?? '') ?? '') })
  $('[data-user][data-domain]').each((_, el) => { found.push(`${$(el).attr('data-user')}@${$(el).attr('data-domain')}`) })
  $('script, style').remove()
  const text = $.root().text()
  found.push(...(text.match(EMAIL) ?? []))
  for (const match of text.matchAll(OBFUSCATED)) found.push(`${match[1]}@${(match[2] ?? '').replace(/\s*[[(]\s*dot\s*[\])]\s*/gi, '.')}`)
  return found
}

function classify(email: string): FoundEmail | undefined {
  const lower = email.trim().toLowerCase()
  const [local, domain] = lower.split('@')
  if (!local || !domain || IMAGE_SUFFIX.test(domain) || IGNORED_LOCAL_PARTS.test(local)) return undefined
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(lower)) return undefined
  return { email: lower, kind: GENERAL_LOCAL_PARTS.has(local.replace(/[._-]/g, '')) ? 'general' : 'personal' }
}

// Addresses on the company's own domain (or a subdomain of it), deduplicated.
export function findPublishedEmails(html: string, companyDomain: string): FoundEmail[] {
  const own = (address: string): boolean => {
    const host = address.split('@')[1] ?? ''
    return host === companyDomain || host.endsWith(`.${companyDomain}`)
  }
  const unique = new Map<string, FoundEmail>()
  for (const raw of candidates(html)) {
    const found = classify(raw)
    if (found && own(found.email)) unique.set(found.email, found)
  }
  return [...unique.values()]
}
