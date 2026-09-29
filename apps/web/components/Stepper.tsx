import type { ReactNode } from 'react'

export type StepState = 'done' | 'active' | 'upcoming' | 'skipped'
export type Step = {
  key: string
  title: string
  state: StepState
  /** One-line mono summary on the right (e.g. what was verified). */
  summary?: ReactNode
  optional?: boolean
  /** Rendered under the title while the step is active. */
  children?: ReactNode
}

function Marker({ n, state }: { n: number; state: StepState }) {
  const base = 'grid h-8 w-8 shrink-0 place-items-center rounded-full font-mono text-[12px] font-medium'
  if (state === 'done')
    return (
      <span className={`${base} bg-ok/15 text-ok`} aria-label="Done">
        <svg width="13" height="13" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2 6.3l2.6 2.5L10 3.4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    )
  if (state === 'active') return <span className={`${base} bg-acc text-[#140700]`}>{n}</span>
  if (state === 'skipped') return <span className={`${base} border border-dashed border-edge text-fg3`}>–</span>
  return <span className={`${base} border border-line text-fg3`}>{n}</span>
}

/** A vertical list of steps separated by hairlines; only the active step shows its content. */
export function Stepper({ steps }: { steps: Step[] }) {
  return (
    <ol className="flex flex-col">
      {steps.map((s, i) => (
        <li key={s.key} aria-current={s.state === 'active' ? 'step' : undefined} className={i ? 'mt-5 border-t border-line2 pt-5' : ''}>
          <div className="flex min-h-8 items-center gap-4">
            <Marker n={i + 1} state={s.state} />
            <span className={`whitespace-nowrap text-base sm:text-[17px] ${s.state === 'upcoming' ? 'text-fg3' : 'text-fg'} ${s.state === 'active' ? 'font-semibold' : ''}`}>
              {s.title}
            </span>
            {s.optional && (s.state === 'upcoming' || s.state === 'active') && (
              <span className="inline-flex h-6 shrink-0 items-center rounded-full border border-line px-2.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-fg3">Optional</span>
            )}
            {s.summary && <span className="ml-auto min-w-0 pl-2 text-right font-mono text-[12.5px] text-fg3 [overflow-wrap:anywhere]">{s.summary}</span>}
          </div>
          {s.state === 'active' && s.children && <div className="mt-5 sm:pl-12">{s.children}</div>}
        </li>
      ))}
    </ol>
  )
}
