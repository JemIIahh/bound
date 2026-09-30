import type { ReactNode } from 'react'
import type { AgentLogEntry } from '@/lib/api'
import { txUrl } from '@/lib/chain'
import { isTxHash, link, short } from './ui'

const isReasonList = (v: unknown): v is { code: string; detail: string }[] =>
  Array.isArray(v) && v.length > 0 && v.every((r) => r && typeof r === 'object' && 'detail' in r && 'code' in r)

function clip(s: string, n = 280) {
  return s.length > n ? `${s.slice(0, n)}…` : s
}

function Value({ v }: { v: unknown }): ReactNode {
  if (v === null || v === undefined) return <span className="text-fg3">—</span>
  if (isTxHash(v))
    return (
      <a href={txUrl(v)} target="_blank" rel="noreferrer" className={link}>
        {short(v)} ↗
      </a>
    )
  if (typeof v === 'string') return clip(v)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (isReasonList(v))
    return (
      <span className="flex flex-col gap-1">
        {v.map((r, i) => (
          <span key={`${r.code}-${i}`}>
            {r.detail} <span className="text-fg3">({r.code})</span>
          </span>
        ))}
      </span>
    )
  return clip(JSON.stringify(v))
}

/** Tool inputs and results as key/value lines, verbatim. */
function Fields({ data }: { data: unknown }) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return (
      <p className="leading-relaxed text-[#D9D6CE] [overflow-wrap:anywhere]">
        <Value v={data} />
      </p>
    )
  }
  const entries = Object.entries(data as Record<string, unknown>).filter(([k]) => k !== 'payee' && k !== 'checkId')
  if (!entries.length) return <p className="text-fg3">no arguments</p>
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 leading-relaxed">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-fg3">{k}</dt>
          <dd className="text-[#D9D6CE] [overflow-wrap:anywhere]">
            <Value v={v} />
          </dd>
        </div>
      ))}
    </dl>
  )
}

const KIND: Record<AgentLogEntry['kind'], string> = { tool_call: 'Call', tool_result: 'Result', text: 'Agent' }

/** A tool result that stopped a payment (blocked verdict, refusal, chain rejection) gets the orange rule. */
function refused(e: AgentLogEntry): boolean {
  if (e.kind !== 'tool_result' || !e.data || typeof e.data !== 'object') return false
  const d = e.data as Record<string, unknown>
  return d.action === 'BLOCK' || d.chain === 'rejected' || d.status === 'blocked'
}

/** The agent's run in order: each tool call, its result, and what the agent wrote. */
export function AgentLog({ entries, live = false, bleed = false }: { entries: AgentLogEntry[]; live?: boolean; /** rows run to the card's edges (log sits directly in a card) */ bleed?: boolean }) {
  const pad = bleed ? 'px-6 sm:px-10' : 'px-3 rounded-lg'
  return (
    <ol className={`flex flex-col font-mono text-[12.5px] sm:text-[13px] ${bleed ? '-mx-6 sm:-mx-10' : '-mx-3'}`}>
      {entries.map((e, i) => {
        const no = refused(e)
        return (
          <li
            key={`${e.at}-${i}`}
            className={`grid grid-cols-[28px_minmax(0,1fr)] gap-x-3 py-2 sm:grid-cols-[36px_minmax(0,1fr)] sm:gap-x-4 ${pad} ${
              no ? 'my-1 bg-acc/12 py-3 shadow-[inset_3px_0_0_var(--color-acc)]' : ''
            }`}
          >
            <span className="text-fg3">{String(i + 1).padStart(2, '0')}</span>
            <div className="flex min-w-0 flex-col gap-1">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className={no ? 'text-acc2' : 'text-fg2'}>{KIND[e.kind] ?? e.kind}</span>
                {e.name && <span className={no ? 'font-medium text-acc2' : 'text-fg'}>{e.name}</span>}
              </p>
              {e.kind === 'text' ? <p className="font-sans text-[15px] leading-relaxed text-fg [overflow-wrap:anywhere]">{String(e.data)}</p> : <Fields data={e.data} />}
            </div>
          </li>
        )
      })}
      {live && (
        <li className={`grid grid-cols-[28px_minmax(0,1fr)] gap-x-3 py-2 sm:grid-cols-[36px_minmax(0,1fr)] sm:gap-x-4 ${pad}`}>
          <span />
          <p className="flex items-center gap-3 font-sans text-[15px] text-fg2">
            <span className="live-dot inline-block h-2 w-2 rounded-full bg-acc" />
            {entries.length ? 'Agent working…' : 'Starting the agent…'}
            <span className="live-dot inline-block h-[15px] w-2 bg-fg2" />
          </p>
        </li>
      )}
    </ol>
  )
}
