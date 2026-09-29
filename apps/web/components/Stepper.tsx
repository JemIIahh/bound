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
  const base = 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px]'
  if (state === 'done')
    return (
      <span className={`${base} bg-ink text-paper`} aria-label="Done">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
    )
  if (state === 'active') return <span className={`${base} border-[1.5px] border-ink text-ink`}>{n}</span>
  if (state === 'skipped') return <span className={`${base} border border-dashed border-black/30 text-graphite`}>–</span>
  return <span className={`${base} border border-black/15 text-graphite`}>{n}</span>
}

/** A vertical list of steps separated by hairlines; only the active step shows its content. */
export function Stepper({ steps }: { steps: Step[] }) {
  return (
    <ol className="flex flex-col">
      {steps.map((s, i) => (
        <li key={s.key} aria-current={s.state === 'active' ? 'step' : undefined} className={i ? 'mt-4 border-t border-black/10 pt-4' : ''}>
          <div className="flex min-h-6 items-center gap-3">
            <Marker n={i + 1} state={s.state} />
            <span className={`whitespace-nowrap text-sm ${s.state === 'upcoming' ? 'text-graphite' : 'text-ink'} ${s.state === 'active' ? 'font-medium' : ''}`}>{s.title}</span>
            {s.optional && (s.state === 'upcoming' || s.state === 'active') && (
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-graphite">Optional</span>
            )}
            {s.summary && <span className="ml-auto min-w-0 truncate pl-2 font-mono text-[11px] text-graphite">{s.summary}</span>}
          </div>
          {s.state === 'active' && s.children && <div className="mt-4 sm:pl-9">{s.children}</div>}
        </li>
      ))}
    </ol>
  )
}
