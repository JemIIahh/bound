'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError, api, errorMessage, type InvoiceDetail, type OrgEvent, type OrgInvoice } from '@/lib/api'
import { txUrl } from '@/lib/chain'
import { ago, usd } from '@/lib/format'
import { useOverview } from '@/lib/hooks'
import { AgentLog } from '@/components/AgentLog'
import { Addr, Pill } from '@/components/atoms'
import { BlockedStamp } from '@/components/BlockedStamp'
import { NetworkNotice } from '@/components/NetworkNotice'
import { PageHead } from '@/components/PageHead'
import { StatusBadge, isOpenStatus } from '@/components/InvoiceStatus'
import { Badge, VerdictCard } from '@/components/VerdictCard'
import { card, cardTitle, errorText, fieldClass, fieldLabel, ghostBtn, hint, link, primaryBtn, short, smallBtn, wrap } from '@/components/ui'
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
    <main className={`${wrap} flex flex-1 flex-col gap-8 py-8 sm:gap-12 sm:py-12`}>
      <PageHead
        title="Try to make your agent pay a stranger."
        lede={
          <>
            Send the agent an invoice an attacker wrote. With the guard on, Bound checks the payee before any money moves. Switch the guard off and the agent sends
            whatever it&apos;s told. Tempo still refuses any wallet you never approved.
          </>
        }
      >
        <p className="flex flex-wrap gap-x-5 gap-y-1 text-[14px] text-fg3">
          <span>{o.org.name}</span>
          <span>
            Agent key <span className="font-mono text-[12.5px]">{short(o.org.agentKeyAddress)}</span>
          </span>
          <span>{o.capacity.used} allowlisted</span>
          <Link href={`/app/${o.org.id}`} className={link}>
            Dashboard
          </Link>
        </p>
      </PageHead>

      <NetworkNotice check={state.network} />

      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2 lg:gap-6">
        {labDisabled ? (
          <div className={`${card} flex min-w-0 flex-col gap-4`} role="status">
            <div>
              <Pill tone="amber">Attack lab</Pill>
            </div>
            <p className={`mt-2 ${cardTitle}`}>Attack lab is disabled on this network</p>
            <p className="text-[15px] leading-relaxed text-fg2">The server only runs the lab on testnet, unless it was started with the lab enabled.</p>
          </div>
        ) : (
          <form onSubmit={run} className={`${card} flex min-w-0 flex-col gap-6`} noValidate>
            <div className="flex items-center justify-between gap-4">
              <Pill>Attack lab</Pill>
              <span className="text-[15px] text-fg3">{guardOff ? 'Guard off' : 'Guard on'}</span>
            </div>
            <div className="flex flex-col gap-3">
              <h2 className={cardTitle}>Write the scam</h2>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Presets">
                {PRESETS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => load(p)}
                    disabled={!!p.missing}
                    title={p.missing ? `Set ${p.missing} to use this preset` : undefined}
                    aria-pressed={presetKey === p.key}
                    className={`${smallBtn} aria-pressed:border-fg aria-pressed:bg-fg aria-pressed:text-ink`}
                  >
                    {p.title}
                  </button>
                ))}
              </div>
              {preset ? <p className="text-[14.5px] leading-relaxed text-fg2">{preset.about}</p> : <p className={hint}>Pick a preset, or write your own invoice.</p>}
              {PRESETS.some((p) => p.missing) && (
                <p className={hint}>
                  Some presets need their wallet set: {Array.from(new Set(PRESETS.filter((p) => p.missing).map((p) => p.missing))).join(', ')}.
                </p>
              )}
            </div>

            <div className="flex flex-1 flex-col">
              <label htmlFor="labText" className={fieldLabel}>
                Invoice
              </label>
              <textarea
                id="labText"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={12}
                placeholder="From: …&#10;Invoice …&#10;Pay to (Tempo): 0x…"
                className={`${fieldClass} flex-1 resize-y text-[13px] leading-relaxed`}
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

        <div ref={resultRef} className="flex min-w-0 scroll-mt-6 flex-col">
          {selected ? (
            <RunResult key={selected} orgId={orgId} invoiceId={selected} meta={runs[selected]} />
          ) : (
            <div className={`${card} flex flex-1 flex-col`}>
              <div className="flex items-center justify-between gap-4">
                <Pill>Result</Pill>
                <span className="text-[15px] text-fg3">Nothing run yet</span>
              </div>
              <p className={`mt-6 ${cardTitle} !text-fg3`}>Run the agent and watch what it does.</p>
              <p className="mt-2 text-[15px] leading-relaxed text-fg2">
                Each run shows the agent&apos;s log, what Bound decided, and — with the guard off — what Tempo did with the payment.
              </p>
              <ul className="mt-8 flex flex-col border-t border-line2 text-[15px] text-fg2">
                {[
                  ['bg-acc', 'Blocked by Bound', 'the wallet imitates or isn’t the supplier'],
                  ['bg-acc', 'Blocked by Tempo', 'guard off, and the wallet was never approved'],
                  ['bg-amber', 'Needs approval', 'a real supplier you haven’t approved yet'],
                  ['bg-ok', 'Paid', 'verified and approved'],
                ].map(([dot, title, text]) => (
                  <li key={title} className="flex items-baseline gap-3 border-b border-line2 py-3">
                    <span className={`h-2 w-2 shrink-0 translate-y-[-1px] rounded-full ${dot}`} />
                    <span>
                      <b className="font-semibold text-fg">{title}</b> — {text}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <section className={`${card} min-w-0`} aria-labelledby="runs-label">
        <div className="flex items-center justify-between gap-4">
          <h2 id="runs-label" className={cardTitle}>
            Runs
          </h2>
          {labRuns.length > 0 && <span className="text-[15px] text-fg3">{labRuns.length}</span>}
        </div>
        {labRuns.length === 0 ? (
          <p className="mt-4 text-[15px] text-fg2">No lab runs yet. Each run shows its own result here; lab runs don&apos;t count toward the dashboard totals.</p>
        ) : (
          <ul className="mt-4 flex flex-col">
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
    <div className="flex items-start justify-between gap-4 border-t border-line2 pt-6">
      <div className="min-w-0">
        <p id="guard-label" className="text-[15px] font-semibold text-fg">
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
        className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition ${off ? 'bg-acc' : 'bg-[#2A2E36]'}`}
      >
        <span className={`absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full transition-all ${off ? 'left-[24px] bg-[#140700]' : 'left-[4px] bg-fg3'}`} />
      </button>
    </div>
  )
}

function RunRow({ inv, events, meta, active, onSelect }: { inv: OrgInvoice; events: OrgEvent[]; meta: RunMeta | undefined; active: boolean; onSelect: () => void }) {
  const p = meta?.preset ? PRESETS.find((x) => x.key === meta.preset) : undefined
  const info = [inv.invoiceNo, usd(inv.amountBase), meta?.guardOff ? 'Guard off' : null, ago(inv.createdAt)].filter(Boolean).join(' · ')
  return (
    <li className="border-t border-line2">
      <button
        onClick={onSelect}
        aria-current={active ? 'true' : undefined}
        className={`-mx-3 flex w-[calc(100%+24px)] items-center justify-between gap-4 rounded-2xl px-3 py-4 text-left transition hover:bg-raised ${active ? 'bg-raised' : ''}`}
      >
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-fg [overflow-wrap:anywhere]">{p?.title ?? inv.payeeName ?? 'Custom invoice'}</p>
          <p className="mt-0.5 text-[13px] text-fg3">{info}</p>
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
    <section className={`${card} flex flex-1 flex-col overflow-hidden !p-0`} aria-live="polite" aria-labelledby="result-label">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line2 px-6 py-5 sm:px-10">
        <div className="flex min-w-0 items-center gap-3 text-[15px] font-semibold">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#1F2227]" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="#A4A8B1" strokeWidth="1.6">
              <rect x="3" y="5" width="12" height="9" rx="3" />
              <path d="M9 2v3" strokeLinecap="round" />
              <circle cx="6.8" cy="9.5" r="1" fill="#A4A8B1" stroke="none" />
              <circle cx="11.2" cy="9.5" r="1" fill="#A4A8B1" stroke="none" />
            </svg>
          </span>
          <span id="result-label">Result</span>
          <span className="min-w-0 font-normal text-fg2 [overflow-wrap:anywhere]">{p?.title ?? d?.invoiceNo}</span>
        </div>
        {live && <Pill live>Live</Pill>}
        {meta && (
          <span className="flex items-center gap-2 whitespace-nowrap text-sm text-fg2 sm:ml-auto">
            Bound check
            <span className={`relative h-5 w-8 rounded-full ${meta.guardOff ? 'bg-[#2A2E36]' : 'bg-ok'}`} aria-hidden="true">
              <span className={`absolute top-[3px] h-3.5 w-3.5 rounded-full ${meta.guardOff ? 'left-[3px] bg-fg3' : 'right-[3px] bg-bg'}`} />
            </span>
            <b className="font-semibold text-fg">{meta.guardOff ? 'Off' : 'On'}</b>
          </span>
        )}
      </div>

      <div className="px-6 py-8 sm:px-10">{d ? <OutcomeView out={out} d={d} orgId={orgId} /> : <Working />}</div>
      {error && <p className={`px-6 pb-4 sm:px-10 ${errorText}`}>{error}</p>}

      <div className="border-t border-line2 px-6 py-6 sm:px-10">
        <h3 className="text-lg font-semibold tracking-[-0.015em]">Agent log</h3>
        <div className="mt-3">
          {d && !d.agentLog.length && !live ? <p className="text-[15px] text-fg3">The agent logged nothing for this run.</p> : <AgentLog entries={d?.agentLog ?? []} bleed />}
        </div>
      </div>
      <p className="mt-auto border-t border-line2 px-6 py-4 font-mono text-[12.5px] text-fg3 [overflow-wrap:anywhere] sm:px-10">{invoiceId}</p>
    </section>
  )
}

function Working() {
  return (
    <p className="flex items-center gap-3 text-xl font-semibold tracking-[-0.015em] text-fg">
      <span className="live-dot inline-block h-2 w-2 rounded-full bg-acc" />
      The agent is working…
    </p>
  )
}

const headline = 'text-2xl font-semibold leading-[1.2] tracking-[-0.025em] text-fg'
const body = 'text-[15px] leading-relaxed text-fg2'
/** Only an https explorer URL that ends in a real 32-byte transaction hash becomes a link. */
const safeTxUrl = (url: string | null) => (url && /^https:\/\/[^/\s]+\/tx\/0x[0-9a-fA-F]{64}$/.test(url) ? url : null)
const explorerLink = (url: string | null, label: string) => {
  const href = safeTxUrl(url)
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={`${ghostBtn} mt-2 sm:w-auto sm:self-start`}>
      {label} ↗
    </a>
  ) : null
}

function OutcomeView({ out, d, orgId }: { out: Outcome; d: InvoiceDetail; orgId: string }) {
  const amount = usd(d.amountBase)
  const to = d.payeeName ?? (d.address ? short(d.address) : 'the payee')
  switch (out.kind) {
    case 'working':
      return <Working />
    case 'chain_rejected':
      return (
        <div className="flex flex-col gap-4">
          <BlockedStamp className="my-4 self-center" />
          <p className={body}>
            The agent sent {amount ?? 'the payment'} to <span className="font-mono text-[13px] text-fg">{(d.payment?.toAddress ?? d.address) && <Addr value={(d.payment?.toAddress ?? d.address)!} />}</span>. The agent
            key isn&apos;t allowed to pay that wallet, so the transaction reverted onchain{out.code ? ` (${out.code})` : ''}. No money moved.
          </p>
          {explorerLink(out.url, 'View the reverted transaction')}
        </div>
      )
    case 'refused_unsent':
      return (
        <div className="flex flex-col gap-4">
          <BlockedStamp verb="Refused" className="my-4 self-center" />
          <p className={body}>Tempo refused the transfer before it was broadcast{out.code ? ` (${out.code})` : ''}. No money moved.</p>
        </div>
      )
    case 'not_sent':
      return (
        <div className="flex flex-col gap-3">
          <div>
            <Badge tone="grey">Not sent</Badge>
          </div>
          <p className={`mt-2 ${headline}`}>Not sent — the lab only fires payments Tempo will refuse.</p>
          <p className={body}>Tempo would or might have accepted this payment, so the lab didn&apos;t send it. No money moved.</p>
        </div>
      )
    case 'unconfirmed':
      return (
        <div className="flex flex-col gap-3">
          <div>
            <Badge tone="amber">Unconfirmed</Badge>
          </div>
          <p className={`mt-2 ${headline}`}>Sent, awaiting confirmation.</p>
          <p className={body}>Tempo hasn&apos;t confirmed the transaction yet. Check it on the explorer.</p>
          {explorerLink(out.url, 'View the transaction')}
        </div>
      )
    case 'paid':
      return (
        <div className="flex flex-col gap-3">
          <div>
            <Badge tone="green">Paid</Badge>
          </div>
          <p className={`mt-2 ${headline}`}>
            Paid {amount ? `${amount} ` : ''}to {to}.
          </p>
          <p className={body}>The payee is verified and approved, so the agent paid it.</p>
          {explorerLink(out.url, 'View the payment')}
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
          <p className={`mt-2 ${headline}`}>The agent didn&apos;t pay this invoice.</p>
        </div>
      )
    case 'approval':
      return (
        <div className="flex flex-col gap-3">
          <div>
            <Badge tone="amber">Needs approval</Badge>
          </div>
          <p className={`mt-2 ${headline}`}>{to} checks out, but you haven&apos;t approved it yet.</p>
          <p className={body}>Approve it on the dashboard with your root wallet, and the agent pays.</p>
          <Link href={`/app/${orgId}`} className={`${ghostBtn} mt-2 sm:w-auto sm:self-start`}>
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
          <p className={`mt-2 ${headline}`}>Over the agent&apos;s spending limit — pay manually or raise the limit.</p>
        </div>
      )
    case 'failed':
      return (
        <div className="flex flex-col gap-3">
          <div>
            <Badge tone="grey">Failed</Badge>
          </div>
          <p className={`mt-2 ${headline}`}>The agent stopped without a decision.</p>
          {out.note && <p className={`${body} [overflow-wrap:anywhere]`}>{out.note}</p>}
        </div>
      )
  }
}
