export function parseAmount(input: string, decimals = 6): bigint {
  const cleaned = input.replace(/[A-Za-z$€£₦,\s]/g, '')
  if (!/^\d+(\.\d+)?$/.test(cleaned)) throw new Error(`Unparseable amount: "${input}"`)
  const [whole, frac = ''] = cleaned.split('.')
  if (frac.length > decimals) throw new Error(`Too many decimals in "${input}" (max ${decimals})`)
  return BigInt(whole!) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0')
}

export function formatAmount(base: bigint, decimals = 6): string {
  const neg = base < 0n
  const v = neg ? -base : base
  const s = v.toString().padStart(decimals + 1, '0')
  const whole = s.slice(0, -decimals)
  const frac = s.slice(-decimals).replace(/0+$/, '')
  return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`
}
