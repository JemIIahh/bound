'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError, api, errorMessage, type InvoiceDetail, type OrgEvent, type OrgInvoice } from '@/lib/api'
import { txUrl } from '@/lib/chain'
import { ago, usd } from '@/lib/format'
import { useOverview } from '@/lib/hooks'
import { AgentLog } from '@/components/AgentLog'
import { StatusBadge, isOpenStatus } from '@/components/InvoiceStatus'
import { Badge, VerdictCard } from '@/components/VerdictCard'
import { card, errorText, fieldClass, ghostBtn, hint, primaryBtn, sectionLabel, short, smallBtn } from '@/components/ui'
import { OrgGate } from '../OrgChrome'
import { PRESETS, type Preset } from './presets'

type RunMeta = { preset: Preset['key'] | null; guardOff: boolean }
const runsKey = (orgId: string) => `bound.labRuns.${orgId}`

function readRuns(orgId: string): Record<string, RunMeta> {
  try {
    return JSON.parse(sessionStorage.getItem(runsKey(orgId)) ?? '{}') as Record<string, RunMeta>
  } catch {
    return {}
  }
}
function writeRuns(orgId: string, runs: Record<string, RunMeta>) {
  try {
    sessionStorage.setItem(runsKey(orgId), JSON.stringify(runs))
  } catch {
    // storage blocked: run labels last for this page view only
  }
}

export function Lab({ orgId }: { orgId: string }) {
  const state = useOverview(orgId)
  const o = state.data
  const [presetKey, setPresetKey] = useState<Preset['key'] | null>(null)
  const [text, setText] = useState('')
  const [guardOff, setGuardOff] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [labDisabled, setLabDisabled] = useState(false)
  const [runs, setRuns] = useState<Record<string, RunMeta>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const resultRef = useRef<HTMLDivElement>(null)

  useEffect(() => setRuns(readRuns(orgId)), [orgId])

  useEffect(() => {
    if (selected && window.matchMedia('(max-width: 1023px)').matches) resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [selected])

  if (!o) return <OrgGate orgId={orgId} state={state} />

  const preset = PRESETS.find((p) => p.key === presetKey) ?? null
  const labRuns = o.invoices.filter((i) => i.lab === 1)

  function load(p: Preset) {
    setPresetKey(p.key)
    setText(p.text)
    setGuardOff(p.guardOff)
    setError(null)
  }

  async function run(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { invoiceId } = await api<{ invoiceId: string }>(`/v1/lab/${encodeURIComponent(orgId)}/run`, { method: 'POST', orgId, json: { text, guardOff } })
      // the preset label only applies while the text is still the preset's
      const next = { ...runs, [invoiceId]: { preset: preset && text === preset.text ? preset.key : null, guardOff } }
      setRuns(next)
      writeRuns(orgId, next)
      setSelected(invoiceId)
      void state.refresh()
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setLabDisabled(true)
      else setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 items-start gap-10 px-5 py-10 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:gap-x-20">
      <section className="lg:col-start-1 lg:row-start-1 lg:pt-6">
        <p className={`${sectionLabel} mb-6`}>Attack lab · {o.org.name}</p>
        <h1 className="font-display text-4xl font-medium leading-[1.12] tracking-[-0.02em] text-ink sm:text-5xl">Try to make your agent pay a stranger.</h1>
        <p className="mt-6 max-w-md text-[15px] leading-relaxed text-graphite">
          Send the agent an invoice an attacker wrote. With the guard on, Bound checks the payee before any money moves. Switch the guard off and the agent
          sends whatever it&apos;s told. Tempo still refuses any wallet you never approved.
        </p>
        <p className="mt-6 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-graphite">
          <span>Agent key {short(o.org.agentKeyAddress)}</span>
          <span>{o.capacity.used} allowlisted</span>
          <Link href={`/app/${o.org.id}`} className="underline decoration-black/30 underline-offset-4 hover:text-ink">
            Dashboard
          </Link>
        </p>
      </section>

      <div className="flex min-w-0 flex-col gap-4 lg:col-start-2 lg:row-span-2 lg:row-start-1">
        {labDisabled ? (
          <div className={`${card} flex flex-col gap-2`} role="status">
            <span className={sectionLabel}>Attack lab</span>
            <p className="font-display text-2xl tracking-[-0.01em] text-ink">Attack lab is disabled on this network</p>
            <p className="text-sm leading-relaxed text-graphite">The server only runs the lab on testnet, unless it was started with the lab enabled.</p>
          </div>
        ) : (
          <form onSubmit={run} className={`${card} flex flex-col gap-5`} noValidate>
            <div className="flex flex-col gap-3">
              <span className={sectionLabel}>Presets</span>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => load(p)}
                    disabled={!!p.missing}
                    title={p.missing ? `Set ${p.missing} to use this preset` : undefined}
                    aria-pressed={presetKey === p.key}
                    className={`${smallBtn} aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-paper`}
                  >
                    {p.title}
                  </button>
                ))}
              </div>
              {preset ? (
                <p className={hint}>{preset.about}</p>
              ) : (
                <p className={hint}>Pick a preset, or write your own invoice.</p>
              )}
              {PRESETS.some((p) => p.missing) && (
                <p className={hint}>
                  Some presets need their wallet set: {Array.from(new Set(PRESETS.filter((p) => p.missing).map((p) => p.missing))).join(', ')}.
                </p>
              )}
            </div>

            <div>
              <label htmlFor="labText" className="mb-1.5 block text-sm text-ink">
                Invoice
              </label>
              <textarea
                id="labText"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={11}
                placeholder="From: …&#10;Invoice …&#10;Pay to (Tempo): 0x…"
                className={`${fieldClass} resize-y text-[13px] leading-relaxed`}
              />
            </div>

            <GuardSwitch off={guardOff} onChange={setGuardOff} />

            <div className="flex flex-col gap-2">
              <button type="submit" disabled={busy || !text.trim()} className={primaryBtn}>
                {busy ? 'Starting…' : guardOff ? 'Run with the guard off' : 'Run the agent'}
              </button>
              {error && <p className={errorText}>{error}</p>}
            </div>
          </form>
        )}

        <div ref={resultRef} className="scroll-mt-6">
          {selected && <RunResult key={selected} orgId={orgId} invoiceId={selected} meta={runs[selected]} />}
        </div>
      </div>

      <section className="min-w-0 lg:col-start-1 lg:row-start-2" aria-labelledby="runs-label">
        <span id="runs-label" className={`block ${sectionLabel}`}>
          Runs
        </span>
        {labRuns.length === 0 ? (
          <p className="mt-3 text-sm text-graphite">No lab runs yet. Each run shows its own result here; lab runs don&apos;t count toward the dashboard totals.</p>
        ) : (
          <ul className="mt-3 flex flex-col border-t border-black/10">
            {labRuns.map((inv) => (
              <RunRow
                key={inv.id}
                inv={inv}
                events={o.events.filter((e) => e.invoiceId === inv.id)}
                meta={runs[inv.id]}
                active={selected === inv.id}
                onSelect={() => setSelected(inv.id)}
              />
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

function GuardSwitch({ off, onChange }: { off: boolean; onChange: (off: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-black/10 pt-5">
      <div className="min-w-0">
        <p id="guard-label" className="text-sm text-ink">
          Guard off
        </p>
        <p className={`mt-1 ${hint}`}>Skip Bound&apos;s checks. The agent sends the payment directly, and only Tempo&apos;s key rules remain.</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={off}
        aria-labelledby="guard-label"
        onClick={() => onChange(!off)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition ${off ? 'border-ink bg-ink' : 'border-black/15 bg-black/[0.06]'}`}
      >
        <span className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full transition-all ${off ? 'left-[22px] bg-paper' : 'left-[3px] bg-white shadow-sm'}`} />
      </button>
    </div>
  )
}

function RunRow({ inv, events, meta, active, onSelect }: { inv: OrgInvoice; events: OrgEvent[]; meta: RunMeta | undefined; active: boolean; onSelect: () => void }) {
  const p = meta?.preset ? PRESETS.find((x) => x.key === meta.preset) : undefined
  const info = [inv.invoiceNo, usd(inv.amountBase), meta?.guardOff ? 'Guard off' : null, ago(inv.createdAt)].filter(Boolean).join(' · ')
  return (
    <li className="border-b border-black/10">
      <button onClick={onSelect} aria-current={active ? 'true' : undefined} className="group flex w-full items-start justify-between gap-4 py-3 text-left">
        <div className="min-w-0">
          <p className={`truncate text-sm text-ink ${active ? 'underline decoration-1 underline-offset-4' : 'group-hover:underline group-hover:decoration-black/30 group-hover:underline-offset-4'}`}>
            {p?.title ?? inv.payeeName ?? 'Custom invoice'}
          </p>
          <p className="mt-0.5 truncate font-mono text-[11px] text-graphite">{info}</p>
        </div>
        {events.some((e) => e.kind === 'chain_rejected') ? (
          <Badge tone="red">Rejected by Tempo</Badge>
        ) : events.some((e) => e.kind === 'blocked' && e.detail?.reason === 'lab_gate') ? (
          <Badge tone="grey">Not sent</Badge>
        ) : (
          <StatusBadge status={inv.status} />
        )}
      </button>
    </li>
  )
}

type Outcome =
  | { kind: 'working' }
  | { kind: 'chain_rejected'; url: string | null; code?: string }
  | { kind: 'refused_unsent'; code?: string }
  | { kind: 'not_sent' }
  | { kind: 'unconfirmed'; url: string | null }
  | { kind: 'paid'; url: string | null }
  | { kind: 'blocked' }
  | { kind: 'approval' }
  | { kind: 'over_limit' }
  | { kind: 'failed'; note?: string }

type RawTransfer = { ok?: boolean; chain?: string; code?: string; txHash?: string; reason?: string; error?: string }

/** Reads the result from the server's invoice, payment and the raw_transfer tool result (guard off). */
function outcomeOf(d: InvoiceDetail): Outcome {
  const raw = [...d.agentLog].reverse().find((e) => e.kind === 'tool_result' && e.name === 'raw_transfer')?.data as RawTransfer | undefined
  const rawUrl = raw?.txHash && /^0x[0-9a-fA-F]{64}$/.test(raw.txHash) ? txUrl(raw.txHash) : null
  if (d.payment?.status === 'reverted' || raw?.chain === 'rejected') return { kind: 'chain_rejected', url: d.payment?.txUrl ?? rawUrl, code: raw?.code }
  if (raw?.chain === 'not_sent') return /lab only/i.test(raw.reason ?? raw.error ?? '') || !raw.code ? { kind: 'not_sent' } : { kind: 'refused_unsent', code: raw.code }
  switch (d.status) {
    case 'new':
    case 'processing':
      return { kind: 'working' }
    case 'unconfirmed':
      return { kind: 'unconfirmed', url: d.payment?.txUrl ?? rawUrl }
    case 'paid':
      return { kind: 'paid', url: d.payment?.txUrl ?? rawUrl }
    case 'blocked':
      return { kind: 'blocked' }
    case 'awaiting_approval':
      return { kind: 'approval' }
    case 'over_limit':
      return { kind: 'over_limit' }
    default: {
      const last = [...d.agentLog].reverse().find((e) => e.kind === 'text')
      return { kind: 'failed', note: last ? String(last.data) : undefined }
    }
  }
}

const SETTLE_POLLS = 4

/** One lab run: the live agent log and what happened. Polls until the run settles (plus a few polls for the agent's last line). */
function RunResult({ orgId, invoiceId, meta }: { orgId: string; invoiceId: string; meta: RunMeta | undefined }) {
  const [d, setD] = useState<InvoiceDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let stopped = false
    let settled = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      try {
        const next = await api<InvoiceDetail>(`/v1/orgs/${encodeURIComponent(orgId)}/invoices/${encodeURIComponent(invoiceId)}`, { orgId })
        if (stopped) return
        setD(next)
        setError(null)
        if (!isOpenStatus(next.status)) settled++
      } catch (e) {
        if (!stopped) setError(errorMessage(e))
      }
      if (!stopped && settled < SETTLE_POLLS) timer = setTimeout(tick, 1500)
    }
    void tick()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }, [orgId, invoiceId])

  const p = meta?.preset ? PRESETS.find((x) => x.key === meta.preset) : undefined
  const out = d ? outcomeOf(d) : ({ kind: 'working' } as Outcome)
  const live = !d || isOpenStatus(d.status)

  return (
    <section className={card} aria-live="polite" aria-labelledby="result-label">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span id="result-label" className={sectionLabel}>
          Result
        </span>
        <span className="font-mono text-[11px] text-graphite">{[p?.title ?? d?.invoiceNo, meta?.guardOff && p?.key !== 'injected' ? 'Guard off' : null].filter(Boolean).join(' · ')}</span>
      </div>

      <div className="mt-5 border-t border-black/10 pt-5">{d ? <OutcomeView out={out} d={d} orgId={orgId} /> : <Working />}</div>
      {error && <p className={`mt-3 ${errorText}`}>{error}</p>}

      <div className="mt-6 border-t border-black/10 pt-5">
        <span className={sectionLabel}>Agent log</span>
        <div className="mt-4">
          {d && !d.agentLog.length && !live ? <p className="text-sm text-graphite">The agent logged nothing for this run.</p> : <AgentLog entries={d?.agentLog ?? []} live={live} />}
        </div>
      </div>
      <p className="mt-5 border-t border-black/10 pt-4 font-mono text-[11px] text-graphite">{invoiceId}</p>
    </section>
  )
}

function Working() {
  return (
    <p className="flex items-center gap-3 font-display text-xl tracking-[-0.01em] text-ink">
      <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-ink" />
      The agent is reading the invoice…
    </p>
  )
}

const headline = 'font-display text-2xl leading-snug tracking-[-0.01em] text-ink'
const explorerLink = (url: string, label: string) => (
  <a href={url} target="_blank" rel="noreferrer" className={`${ghostBtn} mt-2`}>
    {label} ↗
  </a>
)

function OutcomeView({ out, d, orgId }: { out: Outcome; d: InvoiceDetail; orgId: string }) {
  const amount = usd(d.amountBase)
  const to = d.payeeName ?? (d.address ? short(d.address) : 'the payee')
  switch (out.kind) {
    case 'working':
      return <Working />
    case 'chain_rejected':
      return (
        <div className="flex flex-col gap-3">
          <div>
            <Badge tone="red">Rejected by Tempo</Badge>
          </div>
          <p className={headline}>Our software was off. Tempo still said no.</p>
          <p className="text-sm leading-relaxed text-graphite">
            The agent sent {amount ?? 'the payment'} to <span className="font-mono text-xs text-ink [overflow-wrap:anywhere]">{d.payment?.toAddress ?? d.address}</span>. The agent
            key isn&apos;t allowed to pay that wallet, so the transaction reverted onchain{out.code ? ` (${out.code})` : ''}. No money moved.
          </p>
          {out.url && explorerLink(out.url, 'View the reverted transaction')}
        </div>
      )
    case 'refused_unsent':
      return (
        <div className="flex flex-col gap-3">
          <div>
            <Badge tone="red">Refused by Tempo</Badge>
          </div>
          <p className={headline}>Our software was off. Tempo still said no.</p>
          <p className="text-sm leading-relaxed text-graphite">Tempo refused the transfer before it was broadcast{out.code ? ` (${out.code})` : ''}. No money moved.</p>
        </div>
      )
    case 'not_sent':
      return (
        <div className="flex flex-col gap-3">
          <div>
            <Badge tone="grey">Not sent</Badge>
          </div>
          <p className={headline}>Not sent — the lab only fires payments Tempo will refuse.</p>
          <p className="text-sm leading-relaxed text-graphite">This wallet is one the agent key may pay, so the lab kept the payment to itself.</p>
        </div>
      )
    case 'unconfirmed':
      return (
        <div className="flex flex-col gap-3">
          <div>
            <Badge tone="amber">Awaiting confirmation</Badge>
          </div>
          <p className={headline}>Sent, awaiting confirmation.</p>
          <p className="text-sm leading-relaxed text-graphite">Tempo hasn&apos;t confirmed the transaction yet. Check it on the explorer.</p>
          {out.url && explorerLink(out.url, 'View the transaction')}
        </div>
      )
    case 'paid':
      return (
        <div className="flex flex-col gap-3">
          <div>
            <Badge tone="green">Paid</Badge>
          </div>
          <p className={headline}>
            Paid {amount ? `${amount} ` : ''}to {to}.
          </p>
          <p className="text-sm leading-relaxed text-graphite">The payee is verified and approved, so the agent paid it.</p>
          {out.url && explorerLink(out.url, 'View the payment')}
        </div>
      )
    case 'blocked':
      return d.verdict ? (
        <VerdictCard result={d.verdict} framed={false} />
      ) : (
        <div className="flex flex-col gap-3">
          <div>
            <Badge tone="red">Blocked</Badge>
          </div>
          <p className={headline}>The agent didn&apos;t pay this invoice.</p>
        </div>
      )
    case 'approval':
      return (
        <div className="flex flex-col gap-3">
          <div>
            <Badge tone="amber">Needs approval</Badge>
          </div>
          <p className={headline}>{to} checks out, but you haven&apos;t approved it yet.</p>
          <p className="text-sm leading-relaxed text-graphite">Approve it on the dashboard with your root wallet, and the agent pays.</p>
          <Link href={`/app/${orgId}`} className={`${ghostBtn} mt-2`}>
            Review the approval →
          </Link>
        </div>
      )
    case 'over_limit':
      return (
        <div className="flex flex-col gap-3">
          <div>
            <Badge tone="amber">Over limit</Badge>
          </div>
          <p className={headline}>Over the agent&apos;s spending limit — pay manually or raise the limit.</p>
        </div>
      )
    case 'failed':
      return (
        <div className="flex flex-col gap-3">
          <div>
            <Badge tone="grey">Failed</Badge>
          </div>
          <p className={headline}>The agent stopped without a decision.</p>
          {out.note && <p className="text-sm leading-relaxed text-graphite [overflow-wrap:anywhere]">{out.note}</p>}
        </div>
      )
  }
}
