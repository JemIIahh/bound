import type { Overview } from '@/lib/api'
import { usd } from '@/lib/format'

/** Big figure that always fits its card: sized from the card width and the number of characters. */
function Figure({ value, max, className }: { value: string; max: number; className: string }) {
  const fit = 100 / (Math.max(2, value.length) * 0.6)
  return (
    <p style={{ fontSize: `min(${max}px, ${fit.toFixed(2)}cqw)` }} className={`whitespace-nowrap font-extrabold leading-none tracking-[-0.05em] tabular-nums ${className}`}>
      {value}
    </p>
  )
}

/** The org's running totals, straight from the overview: four separate cards. */
export function Counters({ counters }: { counters: Overview['counters'] }) {
  const figures = [
    { key: 'checks', label: 'Checks', dot: 'bg-fg2', value: counters.checks.toLocaleString('en-US'), sub: 'Payees checked before paying' },
    { key: 'paid', label: 'Paid', dot: 'bg-ok', value: counters.paid.toLocaleString('en-US'), sub: 'Payments that went through' },
    { key: 'blocked', label: 'Blocked', dot: 'bg-acc', value: counters.blocked.toLocaleString('en-US'), sub: 'Stopped before money moved' },
    // whole dollars read cleaner at this size; cents stay when there are any
    { key: 'protected', label: 'Protected', dot: 'bg-fg', value: (usd(counters.protectedBase) ?? '$0.00').replace(/\.00$/, ''), sub: 'Kept out of the wrong wallets' },
  ]
  return (
    <section aria-label="Totals" className="grid grid-cols-3 gap-2 sm:gap-4 lg:grid-cols-4 lg:gap-6">
      {figures.map((f) => {
        const wide = f.key === 'protected'
        return (
          <div
            key={f.key}
            className={`min-w-0 rounded-card border border-line bg-card shadow-card ${wide ? 'col-span-3 -order-1 p-6 sm:p-8 lg:order-none lg:col-span-1' : 'p-4 sm:p-8'}`}
          >
            <p className="flex items-center gap-2 text-sm text-fg2 sm:text-[15px]">
              <i className={`inline-block h-2 w-2 shrink-0 rounded-full ${f.dot}`} />
              {f.label}
            </p>
            {/* same box height in every card (a two-character figure's size), figures sit on its bottom edge */}
            <div className="@container mt-4 sm:mt-6">
              <div style={{ height: `min(64px, ${(100 / 1.2).toFixed(2)}cqw)` }} className="flex items-end">
                <Figure value={f.value} max={64} className={f.key === 'blocked' ? 'text-acc' : 'text-fg'} />
              </div>
            </div>
            <p className={`mt-4 text-sm text-fg3 ${wide ? '' : 'hidden sm:block'}`}>{f.sub}</p>
          </div>
        )
      })}
    </section>
  )
}
