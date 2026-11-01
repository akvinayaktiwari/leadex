import { describe, expect, it } from 'vitest'
import { decodeCloudflareEmail, findPublishedEmails } from '../src/lib/published-emails.js'

// Cloudflare encoding of "jane@acme.com" with key 0x42.
const CF = '42' + Buffer.from(Buffer.from('jane@acme.com').map((byte) => byte ^ 0x42)).toString('hex')

describe('published emails', () => {
  // protects=addresses hidden with Cloudflare protection, data attributes and "[at]/[dot]" are decoded;
  // fails_when=a protected address is missed or decoded wrongly;
  // no_claim=does not run JavaScript, so addresses assembled by scripts are not found.
  it('decodes common encodings', () => {
    expect(decodeCloudflareEmail(CF)).toBe('jane@acme.com')
    const html = `<a class="__cf_email__" data-cfemail="${CF}">[email protected]</a>
      <span data-user="ravi" data-domain="acme.com"></span><p>Write to priya [at] acme [dot] com</p>
      <a href="mailto:Sales@Acme.com?subject=Hi">Sales</a>`
    expect(findPublishedEmails(html, 'acme.com').map((found) => `${found.email}:${found.kind}`).sort())
      .toEqual(['jane@acme.com:personal', 'priya@acme.com:personal', 'ravi@acme.com:personal', 'sales@acme.com:general'])
  })

  // protects=only the company's own domain counts, and automated, legal or image-like strings are ignored;
  // fails_when=a gmail.com address, an agency's address, noreply@, privacy@ or "logo@2x.png" is kept;
  // no_claim=n/a.
  it('keeps own-domain contact addresses only', () => {
    const html = '<p>info@acme.com, jane.doe@mail.acme.com, owner@gmail.com, hello@agency.com, noreply@acme.com, privacy@acme.com</p><img src="logo@2x.png">'
    expect(findPublishedEmails(html, 'acme.com')).toEqual([{ email: 'info@acme.com', kind: 'general' }, { email: 'jane.doe@mail.acme.com', kind: 'personal' }])
  })
})
