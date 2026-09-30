'use client'

import Link from 'next/link'
import { useCallback, useState } from 'react'
import type { Overview } from '@/lib/api'
import { useOverview } from '@/lib/hooks'
import { ApprovalCard } from '@/components/ApprovalCard'
import { Counters } from '@/components/Counters'
import { EventFeed } from '@/components/EventFeed'
import { InvoiceInbox } from '@/components/InvoiceInbox'
import { NetworkNotice } from '@/components/NetworkNotice'
import { card, sectionLabel, smallBtn } from '@/components/ui'
import { KeyNotice, OrgGate, OrgHeader } from './OrgChrome'

/** Tempo's per-scope recipient cap is 57; warn well before it. */
const CAPACITY_WARN = 50

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

export function Dashboard({ orgId }: { orgId: string }) {
  const state = useOverview(orgId)
  const { data: o, error, refresh, network } = state
  const [kept, setKept] = useState<Set<string>>(new Set())

  const keep = useCallback((id: string) => setKept((s) => new Set(s).add(id)), [])
  const dismiss = useCallback(
    (id: string) =>
      setKept((s) => {
        const next = new Set(s)
        next.delete(id)
        return next
      }),
    [],
  )

  if (!o) return <OrgGate orgId={orgId} state={state} />

  // Open approvals, plus any this page just settled (kept until dismissed so the outcome stays visible).
  const queue = o.approvals.filter((a) => a.status === 'pending' || a.status === 'prepared' || kept.has(a.id))
  const labelFor = (wallet: string) =>
    o.pins.find((p) => p.active && same(p.wallet, wallet))?.label ?? o.approvals.find((a) => same(a.wallet, wallet))?.label

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-5 py-10 sm:px-8">
      <OrgHeader
        o={o}
        eyebrow="Payer dashboard"
        action={
          <Link href={`/app/${o.org.id}/lab`} className={smallBtn}>
            Attack lab <span aria-hidden="true">→</span>
          </Link>
        }
      />
      <NetworkNotice check={network} />
      {error && <p className="font-mono text-[12.5px] text-fg3">Couldn&apos;t refresh: {error} Retrying.</p>}
      <KeyNotice o={o} />
      <Counters counters={o.counters} />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          {queue.map((a) => (
            <ApprovalCard
              key={a.id}
              orgId={o.org.id}
              approval={a}
              invoice={o.invoices.find((i) => i.id === a.invoiceId)}
              rootAddress={o.org.rootAddress}
              labelFor={labelFor}
              signBlocked={network.mismatch}
              onChange={() => {
                keep(a.id)
                void refresh()
              }}
              onDismiss={() => dismiss(a.id)}
            />
          ))}
          <InvoiceInbox orgId={o.org.id} invoices={o.invoices} events={o.events} payments={o.payments} onSubmitted={() => void refresh()} />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <Payees o={o} />
          <EventFeed events={o.events} invoices={o.invoices} pins={o.pins} />
        </div>
      </div>
    </main>
  )
}

/** Approved payees and everything else on the agent key's allowlist, with Tempo's 57-recipient capacity. */
function Payees({ o }: { o: Overview }) {
  const root = o.org.rootAddress
  const active = o.pins.filter((p) => p.active)
  const rows = [
    ...active.map((p) => ({ wallet: p.wallet, label: p.label, note: o.allowlist.some((a) => same(a, p.wallet)) ? 'Approved' : 'Not on the allowlist' })),
    ...o.allowlist
      .filter((a) => !same(a, root) && !active.some((p) => same(p.wallet, a)))
      .map((a) => ({ wallet: a, label: o.approvals.find((x) => same(x.wallet, a))?.label ?? 'Allowlisted wallet', note: 'Allowlisted, approval pending' })),
  ]
  const hasRoot = o.allowlist.some((a) => same(a, root))
  const { used, max } = o.capacity
  const full = used >= CAPACITY_WARN

  return (
    <section className={card} aria-labelledby="payees-label">
      <div className="flex items-baseline justify-between gap-3">
        <span id="payees-label" className={sectionLabel}>
          Payees
        </span>
        <span className={`font-mono text-[12.5px] tabular-nums ${full ? 'text-amber' : 'text-fg3'}`} title="Recipients on the agent key's allowlist">
          {used} / {max}
        </span>
      </div>
      {full && (
        <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-amber">
          <span className="mt-[5px] inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber" />
          Nearly full. Tempo allows at most {max} recipients per agent key.
        </p>
      )}
      {rows.length === 0 ? (
        <p className="mt-3 text-sm leading-relaxed text-fg3">No payees yet. Until you approve one, the agent can only pay your own account.</p>
      ) : (
        <ul className="mt-3 flex flex-col">
          {rows.map((r, i) => (
            <li key={r.wallet} className={`py-3 ${i ? 'border-t border-line2' : ''}`}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-sm text-fg">{r.label}</span>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-fg3">{r.note}</span>
              </div>
              <p className="mt-0.5 font-mono text-[12.5px] text-fg3 [overflow-wrap:anywhere]">{r.wallet}</p>
            </li>
          ))}
        </ul>
      )}
      {hasRoot && (
        <p className="mt-3 border-t border-line2 pt-3 font-mono text-[12.5px] leading-relaxed text-fg3">
          Also allowlisted: your root account, so the key starts out able to pay no one else.
        </p>
      )}
    </section>
  )
}
