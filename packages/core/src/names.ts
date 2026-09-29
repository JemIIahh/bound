import { mapConfusables } from './confusables'

const LEGAL_SUFFIXES = new Set([
  'ltd', 'limited', 'llc', 'inc', 'incorporated', 'plc', 'gmbh', 'corp', 'corporation', 'co', 'company',
  'sa', 'bv', 'nv', 'pty', 'ag', 'sarl', 'srl', 'llp', 'lp', 'and',
])

export type NameResult = 'MATCH' | 'CLOSE_MATCH' | 'NO_MATCH'

export function normalizeName(raw: string): { normalized: string; homoglyph: boolean } {
  const nfkc = raw.normalize('NFKC').toLowerCase()
  // Invisible format characters (zero-width, soft hyphen, ...) are a spoofing vector.
  const lowered = nfkc.replace(/\p{Cf}/gu, '')
  const hadInvisible = lowered !== nfkc
  const mapped = mapConfusables(lowered)
  const onlyConfusableLetters = /[a-z]/.test(mapped.text) && /[a-z]/.test(lowered)
  // A name mixing Latin letters with look-alike non-Latin letters is a homoglyph attempt.
  const mixedScript = mapped.changed && onlyConfusableLetters
  const homoglyph = mixedScript || hadInvisible
  const cleaned = (mixedScript ? mapped.text : lowered)
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const tokens = cleaned.split(' ').filter(Boolean)
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1]!)) tokens.pop()
  return { normalized: tokens.join(' '), homoglyph }
}

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return a.length === 0 ? 0 : 1
  if (!a.length || !b.length) return 0
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1)
  const aM = new Array<boolean>(a.length).fill(false)
  const bM = new Array<boolean>(b.length).fill(false)
  let matches = 0
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - range)
    const hi = Math.min(i + range + 1, b.length)
    for (let j = lo; j < hi; j++) {
      if (bM[j] || a[i] !== b[j]) continue
      aM[i] = true; bM[j] = true; matches++; break
    }
  }
  if (!matches) return 0
  let t = 0
  let k = 0
  for (let i = 0; i < a.length; i++) {
    if (!aM[i]) continue
    while (!bM[k]) k++
    if (a[i] !== b[k]) t++
    k++
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3
  let prefix = 0
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++
  return jaro + prefix * 0.1 * (1 - jaro)
}

export function compareNames(invoiceName: string, registeredName: string): { result: NameResult; score: number; homoglyph: boolean } {
  const A = normalizeName(invoiceName)
  const B = normalizeName(registeredName)
  const homoglyph = A.homoglyph && !B.homoglyph
  if (!A.normalized || !B.normalized) return { result: 'NO_MATCH', score: 0, homoglyph }
  if (A.normalized === B.normalized) return { result: homoglyph ? 'CLOSE_MATCH' : 'MATCH', score: 1, homoglyph }
  const score = jaroWinkler(A.normalized, B.normalized)
  const ta = new Set(A.normalized.split(' '))
  const tb = new Set(B.normalized.split(' '))
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta]
  const subset = [...small].every((t) => big.has(t))
  if (score >= 0.85 || (subset && score >= 0.8)) return { result: 'CLOSE_MATCH', score, homoglyph }
  return { result: 'NO_MATCH', score, homoglyph }
}
