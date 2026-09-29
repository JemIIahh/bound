import type { Overview } from '@/lib/api'
import { usd } from '@/lib/format'
import { card, sectionLabel } from './ui'

/** The org's running totals, straight from the overview. */
export function Counters({ counters }: { counters: Overview['counters'] }) {
  const figures = [
    { label: 'Checks run', value: counters.checks.toLocaleString('en-US') },
    { label: 'Paid', value: counters.paid.toLocaleString('en-US') },
    { label: 'Blocked', value: counters.blocked.toLocaleString('en-US') },
    { label: 'Protected', value: usd(counters.protectedBase) ?? '$0.00' },
  ]
  return (
    <div className={`${card} grid grid-cols-2 gap-y-6 sm:grid-cols-4 sm:gap-y-0 sm:[&>*+*]:border-l sm:[&>*+*]:border-black/10 sm:[&>*+*]:pl-6`}>
      {figures.map((f) => (
        <div key={f.label} className="min-w-0">
          <span className={sectionLabel}>{f.label}</span>
          <p className="mt-2 truncate font-display text-3xl tracking-[-0.02em] text-ink tabular-nums">{f.value}</p>
        </div>
      ))}
    </div>
  )
}
