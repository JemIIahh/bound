'use client'

import Link from 'next/link'
import { useCallback, useState } from 'react'
import type { Overview } from '@/lib/api'
import { useOverview } from '@/lib/hooks'
import { ApprovalCard } from '@/components/ApprovalCard'
import { Addr, Avatar, LockIcon, Pill } from '@/components/atoms'
import { Counters } from '@/components/Counters'
import { EventFeed } from '@/components/EventFeed'
import { InvoiceCard, InvoiceComposer, invoiceGroup } from '@/components/InvoiceInbox'
import { NetworkNotice } from '@/components/NetworkNotice'
import { card, cardTitle, ghostBtn, primaryBtn, sectionTitle, smallBtn, wrap } from '@/components/ui'
import { KeyNotice, OrgGate, OrgHeader } from './OrgChrome'

/** Tempo's per-scope recipient cap is 57; warn well before it. */
const CAPACITY_WARN = 50

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

type Filter = 'all' | 'approval' | 'blocked' | 'paid'
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'approval', label: 'Needs approval' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'paid', label: 'Paid' },
]

export function Dashboard({ orgId }: { orgId: string }) {
  const state = useOverview(orgId)
  const { data: o, error, refresh, network } = state
  const [kept, setKept] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')

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

  // The approval card stands in for its invoice's card; the first open approval is the one light card.
  const covered = new Set(queue.map((a) => a.invoiceId))
  const invoices = o.invoices.filter((i) => !covered.has(i.id))
  const waiting = queue.filter((a) => a.status === 'pending' || a.status === 'prepared')
  const highlight = waiting[0]?.id
  const counts: Record<Filter, number> = {
    all: queue.length + invoices.length,
    approval: queue.length + invoices.filter((i) => invoiceGroup(i.status) === 'approval').length,
    blocked: invoices.filter((i) => invoiceGroup(i.status) === 'blocked').length,
    paid: invoices.filter((i) => invoiceGroup(i.status) === 'paid').length,
  }
  const shows = (group: string) => filter === 'all' || filter === group

  const sub = (
    <>
      {waiting.length ? (
        <>
          <b className="font-semibold text-fg">
            {waiting.length} payment{waiting.length === 1 ? '' : 's'}
          </b>{' '}
          {waiting.length === 1 ? 'is' : 'are'} waiting for your OK.
        </>
      ) : (
        'Nothing is waiting for your OK.'
      )}{' '}
      {o.counters.blocked ? `${o.counters.blocked.toLocaleString('en-US')} blocked so far.` : ''}
    </>
  )

  return (
    <main className={`${wrap} flex flex-1 flex-col gap-6 py-8 sm:py-12 lg:gap-6`}>
      <OrgHeader
        o={o}
        sub={sub}
        actions={
          <>
            <Link href="/verify" className={`${ghostBtn} flex-1 !px-4 sm:!px-6 lg:w-auto lg:flex-none`}>
              Check a wallet
            </Link>
            <Link href={`/app/${o.org.id}/lab`} className={`${primaryBtn} flex-1 !px-4 sm:!px-6 lg:w-auto lg:flex-none`}>
              Run a test attack <span aria-hidden="true">→</span>
            </Link>
          </>
        }
      />
      <NetworkNotice check={network} />
      {error && <p className="text-[13px] text-fg3">Couldn&apos;t refresh: {error} Retrying.</p>}
      <KeyNotice o={o} />
      <div className="mt-2 lg:mt-4">
        <Counters counters={o.counters} />
      </div>

      <section aria-labelledby="payments-label" className="mt-6 flex flex-col gap-4 sm:mt-10 lg:gap-6">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <h2 id="payments-label" className={sectionTitle}>
            Payments
          </h2>
          <div role="group" aria-label="Show" className="flex max-w-full flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={`${smallBtn} aria-pressed:border-fg aria-pressed:bg-fg aria-pressed:text-ink`}
              >
                {f.label}
                {counts[f.key] > 0 && <b className="font-semibold tabular-nums">{counts[f.key]}</b>}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-flow-row-dense grid-cols-1 gap-4 min-[768px]:grid-cols-2 lg:gap-6 min-[1100px]:grid-cols-3">
          {queue.map((a) => (
            <ApprovalCard
              key={a.id}
              orgId={o.org.id}
              approval={a}
              invoice={o.invoices.find((i) => i.id === a.invoiceId)}
              rootAddress={o.org.rootAddress}
              labelFor={labelFor}
              signBlocked={network.mismatch}
              highlight={a.id === highlight}
              hidden={!shows('approval')}
              onChange={() => {
                keep(a.id)
                void refresh()
              }}
              onDismiss={() => dismiss(a.id)}
            />
          ))}
          {invoices.map((inv) => (
            <InvoiceCard
              key={inv.id}
              orgId={o.org.id}
              inv={inv}
              events={o.events}
              payment={o.payments.find((p) => p.invoiceId === inv.id)}
              open={open === inv.id}
              onToggle={() => setOpen((x) => (x === inv.id ? null : inv.id))}
              hidden={!shows(invoiceGroup(inv.status))}
            />
          ))}
          {counts.all === 0 && (
            <div className={`${card} col-span-full`}>
              <p className="text-[15px] text-fg2">No invoices yet. The agent verifies every payee before any money moves.</p>
            </div>
          )}
          {counts.all > 0 && counts[filter] === 0 && (
            <div className={`${card} col-span-full`}>
              <p className="text-[15px] text-fg2">Nothing here right now.</p>
            </div>
          )}
        </div>
      </section>

      <InvoiceComposer
        orgId={o.org.id}
        onSubmitted={(invoiceId) => {
          setFilter('all')
          setOpen(invoiceId)
          void refresh()
        }}
      />

      <div className="grid grid-cols-1 items-stretch gap-4 lg:gap-6 min-[1100px]:grid-cols-3">
        <EventFeed className="min-[1100px]:col-span-2" events={o.events} invoices={o.invoices} pins={o.pins} />
        <Payees o={o} />
      </div>
    </main>
  )
}

const SHOW_PAYEES = 6

/** Approved payees and everything else on the agent key's allowlist, with Tempo's 57-recipient capacity. */
function Payees({ o }: { o: Overview }) {
  const [all, setAll] = useState(false)
  const root = o.org.rootAddress
  const active = o.pins.filter((p) => p.active)
  const rows = [
    ...active.map((p) => ({ wallet: p.wallet, label: p.label, note: o.allowlist.some((a) => same(a, p.wallet)) ? 'Approved' : 'Not on the approved list' })),
    ...o.allowlist
      .filter((a) => !same(a, root) && !active.some((p) => same(p.wallet, a)))
      .map((a) => ({ wallet: a, label: o.approvals.find((x) => same(x.wallet, a))?.label ?? 'Approved wallet', note: 'On the list, approval pending' })),
  ]
  const hasRoot = o.allowlist.some((a) => same(a, root))
  const { used, max } = o.capacity
  const full = used >= CAPACITY_WARN
  const shown = all ? rows : rows.slice(0, SHOW_PAYEES)

  return (
    <section className={`${card} flex min-w-0 flex-col`} aria-labelledby="payees-label">
      <div className="flex items-center justify-between gap-4">
        <Pill icon={<LockIcon />}>Tempo rule</Pill>
        <span className="whitespace-nowrap text-2xl font-medium leading-none tracking-[-0.02em] tabular-nums sm:text-[26px]" title="Suppliers on the agent's approved list">
          <span className={full ? 'text-amber' : 'text-fg'}>{used}</span>
          <small className="ml-1 text-[13px] font-medium tracking-normal text-fg3">/ {max}</small>
        </span>
      </div>
      <h3 id="payees-label" className={`mt-8 ${cardTitle}`}>
        Your agent can only pay these
      </h3>
      <p className="mt-2 text-[15.5px] leading-[1.55] text-fg2">Tempo enforces this list on the agent&apos;s payment key itself — even when Bound is switched off.</p>
      {full && (
        <p className="mt-4 flex items-start gap-2 text-[13px] font-medium leading-relaxed text-amber">
          <span className="mt-[6px] inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber" />
          Nearly full. Tempo allows at most {max} recipients per payment key.
        </p>
      )}
      {rows.length === 0 ? (
        <p className="mt-6 text-[15px] leading-relaxed text-fg3">No payees yet. Until you approve one, the agent can only pay your own account.</p>
      ) : (
        <ul className="mt-6 flex flex-col">
          {shown.map((r) => (
            <li key={r.wallet} className="flex items-center gap-4 border-t border-line2 py-3">
              <Avatar name={r.label} size={32} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="text-[15px] font-semibold text-fg">{r.label}</span>
                  <span className="text-[13px] text-fg3">{r.note}</span>
                </div>
                <p className="mt-0.5 font-mono text-[12px] text-fg3">
                  <Addr value={r.wallet} />
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {rows.length > SHOW_PAYEES && (
        <div className="border-t border-line2 pt-4">
          <button onClick={() => setAll((v) => !v)} className={smallBtn}>
            {all ? 'Show less' : `Show all ${rows.length}`}
          </button>
        </div>
      )}
      {hasRoot && <p className="mt-auto border-t border-line2 pt-4 text-[13px] leading-relaxed text-fg3">Also on the list: your company wallet, so the key starts out able to pay no one else.</p>}
    </section>
  )
}
