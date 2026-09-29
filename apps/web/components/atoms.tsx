import type { ReactNode } from 'react'

export type Tone = 'green' | 'amber' | 'grey' | 'red'

const PILL: Record<Tone, string> = {
  green: 'border-ok/40 bg-ok/10 text-ok',
  amber: 'border-amber/45 bg-amber/10 text-amber',
  grey: 'border-fg/20 text-fg2',
  red: 'border-acc/50 bg-acc/12 text-acc2',
}

/** Small mono uppercase tag (card top-left). Amber (pending) and live tags carry a dot. */
export function Pill({ tone = 'grey', dot, live, icon, children }: { tone?: Tone; dot?: string; live?: boolean; icon?: ReactNode; children: ReactNode }) {
  const cls = live ? 'border-acc/45 text-acc2' : PILL[tone]
  const showDot = dot ?? (live || tone === 'amber' ? 'bg-current' : null)
  return (
    <span className={`inline-flex h-7 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3 font-mono text-[11.5px] font-medium uppercase tracking-[0.08em] ${cls}`}>
      {showDot && <span className={`inline-block h-1.5 w-1.5 rounded-full ${showDot} ${live ? 'live-dot' : ''}`} />}
      {icon}
      {children}
    </span>
  )
}

/** "$12.50 USDT" (card top-right). */
export function Amount({ value, unit = 'USDT', className = '' }: { value: string | null | undefined; unit?: string; className?: string }) {
  if (!value) return <span className={`whitespace-nowrap text-[15px] text-fg3 ${className}`}>No amount</span>
  return (
    <span className={`whitespace-nowrap text-2xl font-medium leading-none tracking-[-0.02em] text-fg tabular-nums sm:text-[26px] ${className}`}>
      {value}
      <small className="ml-1 text-[13px] font-medium tracking-normal text-fg3">{unit}</small>
    </span>
  )
}

const AV = ['#3C4F7A', '#56705B', '#A3662B', '#6B4E8C', '#7A4B3C', '#3C6E7A']

/** Round initial avatar; `flagged` shows the lookalike "?" treatment. */
export function Avatar({ name, flagged = false, size = 40 }: { name: string | null | undefined; flagged?: boolean; size?: number }) {
  const style = { width: size, height: size, fontSize: size <= 32 ? 13 : 15 }
  if (flagged)
    return (
      <span aria-hidden="true" style={style} className="grid shrink-0 place-items-center rounded-full bg-raised font-bold text-acc2 shadow-[inset_0_0_0_1.5px_rgba(255,91,31,0.7)]">
        ?
      </span>
    )
  const n = (name ?? '').replace(/[^\p{L}\p{N}]/gu, '')
  const initial = n ? n[0]!.toUpperCase() : '·'
  let h = 0
  for (const c of n) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return (
    <span aria-hidden="true" style={{ ...style, background: AV[h % AV.length] }} className="grid shrink-0 place-items-center rounded-full font-bold text-white">
      {initial}
    </span>
  )
}

export function ArrowIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function CheckIcon({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2 6.3l2.6 2.5L10 3.4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function CrossIcon({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}

export function LockIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7.5" rx="1.5" fill="currentColor" />
      <path d="M5.2 7V5.2a2.8 2.8 0 015.6 0V7" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}

export function ShieldIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 1.5l3.8 1.6v2.6c0 2.3-1.6 4-3.8 4.8C3.8 9.7 2.2 8 2.2 5.7V3.1z" fill="currentColor" />
    </svg>
  )
}

/** Wordmark: orange square + Bound. */
export function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className={`flex items-center gap-2 font-extrabold tracking-[-0.02em] text-fg [font-stretch:115%] ${small ? 'text-lg' : 'text-xl sm:text-[22px]'}`}>
      <i className="inline-block h-3 w-3 rounded-[3px] bg-acc shadow-[0_0_16px_rgba(255,91,31,0.6)]" />
      Bound
    </span>
  )
}

/** Card footer: avatar, two meta lines (the second mono), optional action on the right. Lines wrap, never clip. */
export function CardFoot({ avatar, m1, m2, action, className = '' }: { avatar?: ReactNode; m1: ReactNode; m2?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center gap-4 ${className}`}>
      {avatar}
      <div className="min-w-0 flex-1">
        <p className="text-[14.5px] leading-snug text-fg">{m1}</p>
        {m2 && <p className="mt-0.5 font-mono text-[12.5px] leading-snug text-fg3 [overflow-wrap:anywhere]">{m2}</p>}
      </div>
      {action}
    </div>
  )
}
