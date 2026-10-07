import type { ReactNode } from 'react'

/** The "Blocked by Tempo" rubber stamp: the chain refused a payment even with Bound's check switched off. `by` names who stopped it. */
export function BlockedStamp({
  verb = 'Blocked',
  by = 'Tempo',
  note = 'Our software was off. Tempo still said no.',
  className = '',
}: {
  verb?: string
  by?: string
  note?: ReactNode
  className?: string
}) {
  return (
    <div
      className={`-rotate-6 whitespace-nowrap rounded-2xl border-4 border-acc bg-[rgba(16,14,13,0.85)] p-1.5 text-acc shadow-[0_20px_50px_-10px_rgba(0,0,0,0.7),0_0_60px_-10px_rgba(255,90,60,0.35)] ${className}`}
    >
      <div className="rounded-[10px] border-2 border-acc px-4 py-2 text-center sm:px-6 sm:py-3">
        <b className="block text-[30px] font-black uppercase leading-[0.95] tracking-[-0.01em] sm:text-[54px]">
          {verb}
          <br />
          by {by}
        </b>
        <small className="mt-1.5 block text-[11.5px] font-semibold text-[#FFB08F] sm:mt-2 sm:text-[13px]">{note}</small>
      </div>
    </div>
  )
}
