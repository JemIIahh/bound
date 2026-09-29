import { domainToUnicode } from 'node:url'
import { mapConfusables } from './confusables'

const TWO_LEVEL_SUFFIXES = new Set(['co.uk', 'com.ng', 'org.ng', 'co.za', 'com.au', 'co.jp', 'com.br', 'com.cn', 'co.ke', 'com.gh', 'co.in', 'com.sg'])
const LABEL_NOISE = new Set(['ltd', 'llc', 'inc', 'plc', 'co', 'group', 'hq', 'pay', 'payments', 'billing', 'invoice', 'invoices', 'global', 'official'])

export function normalizeDomain(raw: string): string {
  let d = raw.trim().toLowerCase()
  if (d.includes('@')) d = d.slice(d.lastIndexOf('@') + 1)
  d = d.replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/^www\./, '').replace(/\.$/, '')
  return d
}

function coreLabel(domain: string): string {
  const unicode = domainToUnicode(normalizeDomain(domain)) || normalizeDomain(domain)
  const d = mapConfusables(unicode).text
  const parts = d.split('.')
  const lastTwo = parts.slice(-2).join('.')
  const labels = TWO_LEVEL_SUFFIXES.has(lastTwo) ? parts.slice(0, -2) : parts.slice(0, -1)
  const label = labels.at(-1) ?? d
  return label
    .replace(/rn/g, 'm')
    .replace(/vv/g, 'w')
    .split('-')
    .filter((t) => t && !LABEL_NOISE.has(t))
    .join('')
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!
    dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return dp[b.length]!
}

export function isLookalikeDomain(candidate: string, registered: string): boolean {
  const c = normalizeDomain(candidate)
  const r = normalizeDomain(registered)
  if (!c || !r || c === r || c.endsWith('.' + r)) return false
  const cl = coreLabel(c)
  const rl = coreLabel(r)
  if (!cl || !rl) return false
  return cl === rl || levenshtein(cl, rl) <= 1
}

export function findLookalikeDomain<T extends { domain: string }>(candidate: string, registered: T[]): T | null {
  for (const r of registered) if (isLookalikeDomain(candidate, r.domain)) return r
  return null
}
