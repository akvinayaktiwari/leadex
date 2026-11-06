// Free mailbox providers. An address here says nothing about the company, so the "free credits once per email domain"
// rule applies per account for these instead (otherwise only the first Gmail user would ever get free credits).
export const WEBMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'yahoo.co.in', 'ymail.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'zoho.com', 'zohomail.in', 'gmx.com', 'gmx.net',
  'mail.com', 'yandex.com', 'rediffmail.com', 'fastmail.com', 'hey.com', 'tutanota.com',
])
