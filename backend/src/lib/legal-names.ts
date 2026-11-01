// Normalizes company names so "Acme Technologies Pvt. Ltd." and "ACME TECHNOLOGIES PRIVATE LIMITED" compare equal.

// Legal-form words removed from the end of a name (in any order, repeatedly). Kept to forms, never words that
// distinguish companies ("holdings", "group", "technologies" stay).
const LEGAL_FORM_TOKENS = new Set([
  'inc', 'incorporated', 'llc', 'llp', 'lp', 'ltd', 'limited', 'plc', 'corp', 'corporation', 'co', 'company',
  'pvt', 'private', 'pte', 'pty', 'opc', 'sa', 'sas', 'srl', 'spa', 'bv', 'nv', 'ab', 'oy', 'as', 'gmbh', 'ag', 'kg',
  'kk', 'sdn', 'bhd', 'tbk', 'fze', 'fzco', 'fzc', 'fz', 'dmcc', 'wll', 'ltda', 'sac', 'de', 'cv', 'the',
])

function words(name: string): string[] {
  return name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
}

// "S.A." and "L.L.C." arrive as single letters; join a trailing run of them so they read as one legal form.
function joinTrailingInitials(tokens: string[]): string[] {
  let start = tokens.length
  while (start > 0 && (tokens[start - 1] ?? '').length === 1) start -= 1
  return tokens.length - start >= 2 ? [...tokens.slice(0, start), tokens.slice(start).join('')] : tokens
}

// Returns '' when nothing meaningful is left (e.g. a name made only of legal-form words).
export function legalNameKey(name: string): string {
  const tokens = joinTrailingInitials(words(name))
  while (tokens.length > 1 && LEGAL_FORM_TOKENS.has(tokens[tokens.length - 1] ?? '')) tokens.pop()
  if (tokens[0] === 'the' && tokens.length > 1) tokens.shift()
  const key = tokens.join(' ')
  return LEGAL_FORM_TOKENS.has(key) ? '' : key
}
