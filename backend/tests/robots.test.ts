import { describe, expect, it } from 'vitest'
import { isPathAllowed, parseRobots } from '../src/lib/robots.js'

const ROBOTS = `
# comment
User-agent: *
Disallow: /private
Allow: /private/press
Disallow: /*.pdf$

User-agent: LeadexBot
User-agent: OtherBot
Disallow: /pricing
`

describe('robots.txt', () => {
  // protects=the crawler obeys the group addressed to it, else the * group;
  // fails_when=a LeadexBot-specific Disallow is ignored, or * rules leak into a bot that has its own group;
  // no_claim=does not implement crawl-delay or sitemaps.
  it('selects the most specific user-agent group', () => {
    const policy = parseRobots(ROBOTS)
    expect(isPathAllowed(policy, 'leadexbot', '/pricing')).toBe(false)
    expect(isPathAllowed(policy, 'leadexbot', '/private')).toBe(true)
    expect(isPathAllowed(policy, 'somebot', '/pricing')).toBe(true)
  })

  // protects=longest-match precedence, Allow beating Disallow inside it, and * / $ wildcards;
  // fails_when=/private/press is blocked, /private/x allowed, or /a.pdf vs /a.pdf?x mismatch;
  // no_claim=does not percent-decode paths.
  it('applies longest match and wildcards', () => {
    const policy = parseRobots(ROBOTS)
    expect(isPathAllowed(policy, 'somebot', '/private/x')).toBe(false)
    expect(isPathAllowed(policy, 'somebot', '/private/press/2026')).toBe(true)
    expect(isPathAllowed(policy, 'somebot', '/docs/a.pdf')).toBe(false)
    expect(isPathAllowed(policy, 'somebot', '/docs/a.pdf?x=1')).toBe(true)
  })

  // protects=an empty or rule-less robots.txt blocks nothing;
  // fails_when=a blank Disallow line blocks the whole site;
  // no_claim=nothing about network errors fetching robots (crawl step treats them as allow-all).
  it('allows everything when there are no rules', () => {
    expect(isPathAllowed(parseRobots(''), 'leadexbot', '/')).toBe(true)
    expect(isPathAllowed(parseRobots('User-agent: *\nDisallow:'), 'leadexbot', '/')).toBe(true)
  })
})
