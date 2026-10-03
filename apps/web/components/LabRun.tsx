'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { api, errorMessage, type RunDetail } from '@/lib/api'
import { txUrl } from '@/lib/chain'
import { usd } from '@/lib/format'
import { AgentLog } from './AgentLog'
import { Addr, Pill } from './atoms'
import { BlockedStamp } from './BlockedStamp'
import { isOpenStatus } from './InvoiceStatus'
import { Badge, VerdictCard } from './VerdictCard'
import { card, cardTitle, errorText, ghostBtn, short } from './ui'

// One attack-lab run: the live agent log and what happened. Shared by the org lab (/app/<orgId>/lab) and
// the public demo (/try); each passes the API path that returns its run.

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
  | { kind: 'offline' }
  | { kind: 'failed'; note?: string }

type RawTransfer = { ok?: boolean; chain?: string; code?: string; txHash?: string; reason?: string; error?: string }

/** Reads the result from the server's invoice, payment and the raw_transfer tool result (guard off). */
function outcomeOf(d: RunDetail): Outcome {
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
      // the public demo marks a run whose model call failed (missing or rejected key, outage)
      if (d.offline) return { kind: 'offline' }
      const last = [...d.agentLog].reverse().find((e) => e.kind === 'text')
      return { kind: 'failed', note: last ? String(last.data) : undefined }
    }
  }
}

const SETTLE_POLLS = 4

/** Polls `path` until the run settles (plus a few polls for the agent's last line) and shows the result and the agent log. */
export function RunResult({
  id,
  path,
  orgId,
  title,
  guardOff,
  switchLabel = 'Bound check',
  approvalHref,
}: {
  id: string
  /** API path that returns this run (RunDetail). */
  path: string
  /** Sends the org token (org lab). */
  orgId?: string
  title?: string
  /** Shows the on/off indicator in the header when known. */
  guardOff?: boolean
  switchLabel?: string
  /** Where a payer approves the payee (org lab); without it the result explains approvals instead. */
  approvalHref?: string
}) {
  const [d, setD] = useState<RunDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let stopped = false
    let settled = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      try {
        const next = await api<RunDetail>(path, { orgId })
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
  }, [path, orgId])

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
          <span className="min-w-0 font-normal text-fg2 [overflow-wrap:anywhere]">{title ?? d?.invoiceNo}</span>
        </div>
        {live && <Pill live>Live</Pill>}
        {guardOff !== undefined && (
          <span className="flex items-center gap-2 whitespace-nowrap text-sm text-fg2 sm:ml-auto">
            {switchLabel}
            <span className={`relative h-5 w-8 rounded-full ${guardOff ? 'bg-[#2A2E36]' : 'bg-ok'}`} aria-hidden="true">
              <span className={`absolute top-[3px] h-3.5 w-3.5 rounded-full ${guardOff ? 'left-[3px] bg-fg3' : 'right-[3px] bg-bg'}`} />
            </span>
            <b className="font-semibold text-fg">{guardOff ? 'Off' : 'On'}</b>
          </span>
        )}
      </div>

      <div className="px-6 py-8 sm:px-10">{d ? <OutcomeView out={out} d={d} approvalHref={approvalHref} /> : <Working />}</div>
      {error && <p className={`px-6 pb-4 sm:px-10 ${errorText}`}>{error}</p>}

      <div className="border-t border-line2 px-6 py-6 sm:px-10">
        <h3 className="text-lg font-semibold tracking-[-0.015em]">Agent log</h3>
        <div className="mt-3">
          {d && !d.agentLog.length && !live ? <p className="text-[15px] text-fg3">The agent logged nothing for this run.</p> : <AgentLog entries={d?.agentLog ?? []} bleed />}
        </div>
      </div>
      <p className="mt-auto border-t border-line2 px-6 py-4 font-mono text-[12.5px] text-fg3 [overflow-wrap:anywhere] sm:px-10">{id}</p>
    </section>
  )
}

/** The result card before anything ran: what each outcome means. */
export function ResultPlaceholder({ offPhrase = 'the guard off', offShort = 'guard off' }: { offPhrase?: string; offShort?: string }) {
  return (
    <div className={`${card} flex flex-1 flex-col`}>
      <div className="flex items-center justify-between gap-4">
        <Pill>Result</Pill>
        <span className="text-[15px] text-fg3">Nothing run yet</span>
      </div>
      <p className={`mt-6 ${cardTitle} !text-fg3`}>Run the agent and watch what it does.</p>
      <p className="mt-2 text-[15px] leading-relaxed text-fg2">
        Each run shows the agent&apos;s log, what Bound decided, and — with {offPhrase} — what Tempo did with the payment.
      </p>
      <ul className="mt-8 flex flex-col border-t border-line2 text-[15px] text-fg2">
        {[
          ['bg-acc', 'Blocked by Bound', 'the wallet imitates or isn’t the supplier'],
          ['bg-acc', 'Blocked by Tempo', `${offShort}, and the wallet was never approved`],
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

function OutcomeView({ out, d, approvalHref }: { out: Outcome; d: RunDetail; approvalHref?: string }) {
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
            The agent sent {amount ?? 'the payment'} to <span className="font-mono text-[13px] text-fg">{(d.payment?.toAddress ?? d.address) && <Addr value={(d.payment?.toAddress ?? d.address)!} />}</span>. The agent&apos;s payment key isn&apos;t allowed to pay that wallet, so Tempo rejected the transaction{out.code ? ` (${out.code})` : ''}. No money moved.
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
      return approvalHref ? (
        <div className="flex flex-col gap-3">
          <div>
            <Badge tone="amber">Needs approval</Badge>
          </div>
          <p className={`mt-2 ${headline}`}>{to} checks out, but you haven&apos;t approved it yet.</p>
          <p className={body}>Approve it on the dashboard with your company wallet, and the agent pays.</p>
          <Link href={approvalHref} className={`${ghostBtn} mt-2 sm:w-auto sm:self-start`}>
            Review the approval →
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div>
            <Badge tone="amber">Needs approval</Badge>
          </div>
          <p className={`mt-2 ${headline}`}>The agent stopped and asked a human about {to}.</p>
          <p className={body}>
            The company hasn&apos;t approved this payee, so nothing was paid. Its finance lead approves a payee once, with their own wallet, before the agent can pay it.
          </p>
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
    case 'offline':
      return (
        <div className="flex flex-col gap-3">
          <div>
            <Badge tone="grey">Offline</Badge>
          </div>
          <p className={`mt-2 ${headline}`}>The demo AI is offline right now.</p>
          <p className={body}>The agent couldn&apos;t start, so nothing was sent and no money moved. Try again in a little while.</p>
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
