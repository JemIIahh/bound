// Display formatting only. Amounts arrive from the API as base-unit strings (6 decimals).
import { formatUnits } from 'viem'

const DECIMALS = 6
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** "$1,250.00" from a base-unit string; null when missing or unreadable. */
export function usd(base: string | null | undefined): string | null {
  if (base == null || base === '') return null
  try {
    return money.format(Number(formatUnits(BigInt(base), DECIMALS)))
  } catch {
    return null
  }
}

/** "week", "day", "30 days" … for a spending-limit period. */
export function periodLabel(seconds: number): string {
  const day = 86400
  if (seconds === 7 * day) return 'week'
  if (seconds === day) return 'day'
  if (seconds === 3600) return 'hour'
  if (seconds % day === 0) return `${seconds / day} days`
  if (seconds % 3600 === 0) return `${seconds / 3600} hours`
  return `${seconds} s`
}

/** "just now", "4 min ago", "3 h ago", or a date. `at` is unix seconds. */
export function ago(at: number, now = Date.now() / 1000): string {
  const s = Math.max(0, Math.floor(now - at))
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return new Date(at * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
