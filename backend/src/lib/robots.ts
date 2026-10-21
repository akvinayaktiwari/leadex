// Minimal robots.txt support (RFC 9309): groups by user-agent, Allow/Disallow with * and $,
// longest match wins, Allow wins a tie.

interface RobotsRule {
  allow: boolean
  pattern: string
}

interface RobotsGroup {
  agents: string[]
  rules: RobotsRule[]
}

export interface RobotsPolicy {
  groups: RobotsGroup[]
}

function parseLine(line: string): { field: string; value: string } | undefined {
  const content = line.replace(/#.*$/, '').trim()
  const colon = content.indexOf(':')
  if (colon <= 0) return undefined
  return { field: content.slice(0, colon).trim().toLowerCase(), value: content.slice(colon + 1).trim() }
}

export function parseRobots(text: string): RobotsPolicy {
  const groups: RobotsGroup[] = []
  let current: RobotsGroup | undefined
  let lastWasAgent = false
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseLine(line)
    if (!parsed) continue
    if (parsed.field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] }
        groups.push(current)
      }
      current.agents.push(parsed.value.toLowerCase())
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (!current || (parsed.field !== 'allow' && parsed.field !== 'disallow') || parsed.value === '') continue
    current.rules.push({ allow: parsed.field === 'allow', pattern: parsed.value })
  }
  return { groups }
}

function patternToRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith('$')
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${body}${anchored ? '$' : ''}`)
}

function selectGroup(policy: RobotsPolicy, agentToken: string): RobotsGroup | undefined {
  const token = agentToken.toLowerCase()
  return policy.groups.find((group) => group.agents.includes(token)) ?? policy.groups.find((group) => group.agents.includes('*'))
}

export function isPathAllowed(policy: RobotsPolicy, agentToken: string, path: string): boolean {
  const group = selectGroup(policy, agentToken)
  if (!group) return true
  let best: RobotsRule | undefined
  for (const rule of group.rules) {
    if (!patternToRegExp(rule.pattern).test(path)) continue
    const longer = !best || rule.pattern.length > best.pattern.length
    const tieAllow = best !== undefined && rule.pattern.length === best.pattern.length && rule.allow
    if (longer || tieAllow) best = rule
  }
  return best ? best.allow : true
}

export const ALLOW_ALL: RobotsPolicy = { groups: [] }
