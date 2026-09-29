const CURRENCY = String.raw`(?:[A-Za-z]{2,5}|[$€£₦])`
// optional leading or trailing currency token only; digits with valid thousands groups; optional decimals
const AMOUNT_RE = new RegExp(String.raw`^(?:${CURRENCY}\s?)?([1-9]\d{0,2}(?:,\d{3})+|\d+)(?:\.(\d+))?(?:\s?${CURRENCY})?$`)

export function parseAmount(input: string, decimals = 6): bigint {
  const raw = input.trim()
  const m = AMOUNT_RE.exec(raw)
  if (!m) throw new Error(`Unparseable amount: "${input}"`)
  // currency on both sides is ambiguous
  const hasLead = new RegExp(`^${CURRENCY}`).test(raw)
  const hasTrail = new RegExp(`${CURRENCY}$`).test(raw)
  if (hasLead && hasTrail) throw new Error(`Unparseable amount: "${input}"`)
  const whole = m[1]!.replace(/,/g, '')
  const frac = m[2] ?? ''
  if (frac.length > decimals) throw new Error(`Too many decimals in "${input}" (max ${decimals})`)
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0')
}

export function formatAmount(base: bigint, decimals = 6): string {
  const neg = base < 0n
  const v = neg ? -base : base
  const s = v.toString().padStart(decimals + 1, '0')
  const whole = s.slice(0, -decimals)
  const frac = s.slice(-decimals).replace(/0+$/, '')
  return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`
}
