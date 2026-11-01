import { promises as dns } from 'node:dns'
import type { DomainMail, MailDnsRepository, MailProvider } from '../types/index.js'

function providerOf(mxHost: string): MailProvider {
  if (/(^|\.)(google\.com|googlemail\.com)\.?$/i.test(mxHost)) return 'google'
  if (/\.mail\.protection\.outlook\.com\.?$/i.test(mxHost)) return 'microsoft'
  return 'other'
}

// "No such domain" and "no MX record" both mean the domain cannot receive mail; other DNS errors are real failures.
const NO_MAIL_CODES = new Set(['ENOTFOUND', 'ENODATA'])

export function createMailDnsRepository(resolveMx: (domain: string) => Promise<{ exchange: string; priority: number }[]> = dns.resolveMx): MailDnsRepository {
  return {
    async lookup(domain: string): Promise<DomainMail> {
      try {
        const records = await resolveMx(domain)
        const best = [...records].sort((a, b) => a.priority - b.priority)[0]
        // A null MX ("." per RFC 7505) explicitly says the domain accepts no mail.
        const mxHost = best && best.exchange !== '' && best.exchange !== '.' ? best.exchange.toLowerCase() : ''
        return { domain, mxHost, provider: mxHost ? providerOf(mxHost) : 'other' }
      } catch (error) {
        const code = (error as { code?: string }).code
        if (code && NO_MAIL_CODES.has(code)) return { domain, mxHost: '', provider: 'other' }
        throw error
      }
    },
  }
}
