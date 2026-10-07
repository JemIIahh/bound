'use client'

import { hint } from './ui'

// Controls shared by the /try scenarios (pay an invoice, buy data from a paid API).

export type Notice = { tone: 'amber' | 'grey'; title: string; text: string; /** no run can start: Run stays disabled */ blocking: boolean }

/** Calm copy for a demo that can't run right now. The server's own message is shown as is. */
export function noticeFor(code: string | undefined, status: number, message: string): Notice {
  if (code === 'busy') return { tone: 'amber', title: 'Busy day', text: message, blocking: true }
  if (status === 429) return { tone: 'amber', title: 'That’s the limit for now', text: message, blocking: false }
  // no agent key, no public demo org, or a server that doesn't serve the demo: the same calm offline state
  if (code === 'offline' || code === 'unavailable') return { tone: 'grey', title: 'Demo offline', text: `${message} Try again in a little while.`, blocking: true }
  if (status === 404) return { tone: 'grey', title: 'Demo offline', text: 'The public demo only runs on Tempo testnet.', blocking: true }
  if (status === 0) return { tone: 'grey', title: 'Can’t reach the demo', text: 'The demo server isn’t answering. Try again in a little while.', blocking: false }
  return { tone: 'grey', title: 'Something went wrong', text: message, blocking: false }
}

/** A calm status line (rate limit, daily cap, offline): not an error the visitor caused. */
export function DemoNotice({ notice }: { notice: Notice }) {
  return (
    <div role="status" className="flex gap-3 rounded-2xl border border-line bg-raised px-5 py-4">
      <span className={`mt-[9px] h-2 w-2 shrink-0 rounded-full ${notice.tone === 'amber' ? 'bg-amber' : 'bg-fg3'}`} aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-[15px] font-semibold text-fg">{notice.title}</p>
        <p className="mt-0.5 text-[14.5px] leading-relaxed text-fg2">{notice.text}</p>
      </div>
    </div>
  )
}

/** A labelled on/off switch with a hint ("Bound software"). `danger` turns it coral when on (a hijack, not a safeguard). */
export function Switch({ id, label, text, on, onChange, danger = false }: { id: string; label: string; text: string; on: boolean; onChange: (on: boolean) => void; danger?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-line2 pt-6">
      <div className="min-w-0">
        <p id={`${id}-label`} className="text-[15px] font-semibold text-fg">
          {label}
        </p>
        <p className={`mt-1 ${hint}`}>{text}</p>
      </div>
      <div className="mt-0.5 flex shrink-0 items-center gap-3">
        <span className="w-6 text-right text-[15px] font-semibold text-fg" aria-hidden="true">
          {on ? 'On' : 'Off'}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby={`${id}-label`}
          onClick={() => onChange(!on)}
          className={`relative h-7 w-12 shrink-0 rounded-full transition ${on ? (danger ? 'bg-acc' : 'bg-ok') : 'bg-[#2A2E36]'}`}
        >
          <span className={`absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full transition-all ${on ? 'left-[24px] bg-bg' : 'left-[4px] bg-fg3'}`} />
        </button>
      </div>
    </div>
  )
}

/** Two or more mutually exclusive choices ("Pay an invoice" / "Buy data from a paid API"). */
export function Segmented<T extends string>({ label, options, value, onChange }: { label: string; options: { value: T; label: string }[]; value: T; onChange: (value: T) => void }) {
  return (
    <div role="group" aria-label={label} className="grid w-full auto-cols-fr grid-flow-col gap-1 rounded-[22px] border border-line bg-card p-1 sm:inline-grid sm:w-auto sm:auto-cols-auto sm:rounded-full">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className="min-h-11 rounded-[18px] px-4 py-2 text-[15px] font-semibold leading-tight text-fg2 transition hover:text-fg aria-pressed:bg-fg aria-pressed:text-ink sm:rounded-full sm:px-6"
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
