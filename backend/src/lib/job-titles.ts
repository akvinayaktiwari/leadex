// Normalizes job titles into seniority and department. Matching is by whole word or phrase, so
// "Vice President" never counts as "President" and "Assistant to the CEO" is not a CEO.

export type Seniority = 'owner' | 'c_level' | 'vp' | 'director' | 'head' | 'manager' | 'staff'
export type Department =
  | 'executive' | 'marketing' | 'sales' | 'business_development' | 'engineering' | 'product' | 'design' | 'operations'
  | 'finance' | 'hr' | 'legal' | 'it' | 'customer_success' | 'other'

const SENIORITY_RULES: [Seniority, RegExp][] = [
  ['owner', /\b(owner|co-?owner|founder|co-?founder|proprietor|managing partner|founding partner|principal)\b/],
  // Before c_level, whose "president" would otherwise match "Vice President".
  ['vp', /\b(vp|svp|evp|avp|vice president)\b/],
  ['c_level', /\b(ceo|cto|cfo|coo|cmo|cio|cro|cpo|chief [a-z]+ officer|managing director|president|chairman|chairwoman|chairperson)\b/],
  ['director', /\b(director)\b/],
  ['head', /\b(head of|head)\b/],
  ['manager', /\b(manager|lead|supervisor|team lead)\b/],
]

const DEPARTMENT_RULES: [Department, RegExp][] = [
  ['marketing', /\b(marketing|cmo|brand|growth|digital|communications|content|seo|social media|demand generation)\b/],
  ['sales', /\b(sales|cro|account executive|account manager|revenue)\b/],
  ['business_development', /\b(business development|partnerships|bd)\b/],
  ['engineering', /\b(engineering|engineer|cto|developer|software|technical)\b/],
  ['product', /\b(product|cpo)\b/],
  ['design', /\b(design|designer|creative|ux|ui)\b/],
  ['operations', /\b(operations|coo|ops|supply chain|logistics|projects?)\b/],
  ['finance', /\b(finance|financial|cfo|accounts|accounting|treasury)\b/],
  ['hr', /\b(hr|human resources|people|talent|recruitment|recruiting)\b/],
  ['legal', /\b(legal|counsel|compliance|company secretary)\b/],
  ['it', /\b(it|cio|information technology|systems)\b/],
  ['customer_success', /\b(customer success|customer service|support|client services)\b/],
  ['executive', /\b(ceo|founder|co-?founder|owner|managing director|president|chairman|partner|principal|proprietor)\b/],
]

// Titles that only look senior: an assistant to a CEO is not a CEO, a former founder is not a founder.
const DEMOTERS = /\b(assistant|associate|former|ex-|retired|late|intern|deputy|trainee)\b/

function clean(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9& -]+/g, ' ').replace(/\s+/g, ' ').trim()
}

export function seniorityOf(title: string): Seniority {
  const text = clean(title)
  const rule = SENIORITY_RULES.find(([, pattern]) => pattern.test(text))
  if (!rule) return 'staff'
  return DEMOTERS.test(text) && rule[0] !== 'manager' ? 'staff' : rule[0]
}

export function departmentOf(title: string): Department {
  const text = clean(title)
  return DEPARTMENT_RULES.find(([, pattern]) => pattern.test(text))?.[0] ?? 'other'
}

// True when the title names any of the wanted roles as a whole word or phrase (case-insensitive).
export function titleMatches(title: string, wanted: string[]): boolean {
  const text = ` ${clean(title)} `
  return wanted.some((role) => {
    const phrase = clean(role)
    return phrase !== '' && text.includes(` ${phrase} `)
  })
}

const SENIORITY_ORDER: Seniority[] = ['owner', 'c_level', 'vp', 'director', 'head', 'manager', 'staff']

// Lower is more senior; used to put owners first.
export function seniorityRank(seniority: Seniority): number {
  return SENIORITY_ORDER.indexOf(seniority)
}
