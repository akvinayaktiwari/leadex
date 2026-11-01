import { describe, expect, it } from 'vitest'
import { departmentOf, seniorityOf, titleMatches } from '../src/lib/job-titles.js'

describe('job titles', () => {
  // protects=titles map to seniority by whole word, and look-alike titles are demoted;
  // fails_when="Vice President" counts as president-level, "Assistant to the CEO" as C-level, or "Former Founder" as an owner;
  // no_claim=English titles only.
  it('maps seniority by whole word', () => {
    const cases: [string, string][] = [
      ['Founder & CEO', 'owner'], ['Managing Director', 'c_level'], ['Chief Marketing Officer', 'c_level'],
      ['Vice President, Sales', 'vp'], ['Director of Marketing', 'director'], ['Head of Growth', 'head'],
      ['Marketing Manager', 'manager'], ['Assistant to the CEO', 'staff'], ['Former Founder', 'staff'], ['Accountant', 'staff'],
      ['Principal Architect', 'owner'],
    ]
    expect(cases.map(([title]) => [title, seniorityOf(title)])).toEqual(cases)
  })

  // protects=departments come from the title's own words, with executive titles as executive;
  // fails_when="Head of Growth" is not marketing or "CFO" is not finance;
  // no_claim=a title naming two departments takes the first rule that matches.
  it('maps departments', () => {
    expect([departmentOf('Head of Growth'), departmentOf('CFO'), departmentOf('Founder & CEO'), departmentOf('Sales Director'), departmentOf('Receptionist')])
      .toEqual(['marketing', 'finance', 'executive', 'sales', 'other'])
  })

  // protects=role filters match whole words only;
  // fails_when="Vice President" matches a "President" filter or "CEO" matches "Assistant to the CEO" as a role;
  // no_claim=titleMatches is a filter; seniority demotion is separate (seniorityOf).
  it('matches wanted roles by whole word', () => {
    expect(titleMatches('Vice President of Sales', ['president'])).toBe(true)
    expect(titleMatches('Vice President of Sales', ['ceo'])).toBe(false)
    expect(titleMatches('Head of Marketing', ['marketing'])).toBe(true)
    expect(titleMatches('Marketer', ['marketing'])).toBe(false)
  })
})
