import type { ReactNode } from 'react'
import type { AgentLogEntry } from '@/lib/api'
import { txUrl } from '@/lib/chain'
import { short } from './ui'

const isTxHash = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v)
const isReasonList = (v: unknown): v is { code: string; detail: string }[] =>
  Array.isArray(v) && v.length > 0 && v.every((r) => r && typeof r === 'object' && 'detail' in r && 'code' in r)

function clip(s: string, n = 280) {
  return s.length > n ? `${s.slice(0, n)}…` : s
}

function Value({ v }: { v: unknown }): ReactNode {
  if (v === null || v === undefined) return <span className="text-graphite">—</span>
  if (isTxHash(v))
    return (
      <a href={txUrl(v)} target="_blank" rel="noreferrer" className="underline decoration-black/30 underline-offset-4 hover:decoration-ink">
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
            {r.detail} <span className="text-graphite">({r.code})</span>
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
      <p className="font-mono text-[11px] leading-relaxed text-ink [overflow-wrap:anywhere]">
        <Value v={data} />
      </p>
    )
  }
  const entries = Object.entries(data as Record<string, unknown>).filter(([k]) => k !== 'payee' && k !== 'checkId')
  if (!entries.length) return <p className="font-mono text-[11px] text-graphite">no arguments</p>
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono text-[11px] leading-relaxed">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-graphite">{k}</dt>
          <dd className="text-ink [overflow-wrap:anywhere]">
            <Value v={v} />
          </dd>
        </div>
      ))}
    </dl>
  )
}

const KIND: Record<AgentLogEntry['kind'], string> = { tool_call: 'Call', tool_result: 'Result', text: 'Agent' }

/** The agent's run in order: each tool call, its result, and what the agent wrote. */
export function AgentLog({ entries, live = false }: { entries: AgentLogEntry[]; live?: boolean }) {
  return (
    <ol className="flex flex-col gap-4">
      {entries.map((e, i) => (
        <li key={`${e.at}-${i}`} className="flex gap-4">
          <span className="w-5 shrink-0 pt-[2px] font-mono text-[11px] text-graphite">{String(i + 1).padStart(2, '0')}</span>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <p className="flex flex-wrap items-baseline gap-x-2 font-mono text-[11px]">
              <span className="uppercase tracking-[0.14em] text-graphite">{KIND[e.kind] ?? e.kind}</span>
              {e.name && <span className="text-ink">{e.name}</span>}
            </p>
            {e.kind === 'text' ? <p className="text-sm leading-relaxed text-ink [overflow-wrap:anywhere]">{String(e.data)}</p> : <Fields data={e.data} />}
          </div>
        </li>
      ))}
      {live && (
        <li className="flex gap-4">
          <span className="w-5 shrink-0" />
          <p className="flex items-center gap-3 text-sm text-graphite">
            <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-ink" />
            {entries.length ? 'Agent working…' : 'Starting the agent…'}
          </p>
        </li>
      )}
    </ol>
  )
}
