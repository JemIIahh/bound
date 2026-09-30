'use client'

import { useState } from 'react'
import type { OrgEvent, OrgInvoice, Pin, Verdict } from '@/lib/api'
import { txUrl } from '@/lib/chain'
import { ago, usd } from '@/lib/format'
import { BLOCK_REASONS } from './InvoiceStatus'
import { CheckIcon, CrossIcon, Pill } from './atoms'
import { VERDICTS, type Tone } from './VerdictCard'
import { card, cardTitle, isTxHash, link, short, smallBtn } from './ui'

const ICON: Record<Tone, { bg: string; fg: string }> = {
  green: { bg: 'bg-ok/10', fg: 'text-ok' },
  amber: { bg: 'bg-amber/12', fg: 'text-amber' },
  grey: { bg: 'bg-raised', fg: 'text-fg2' },
  red: { bg: 'bg-acc/12', fg: 'text-acc' },
}

function EventIcon({ tone }: { tone: Tone }) {
  const t = ICON[tone]
  return (
    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${t.bg} ${t.fg}`} aria-hidden="true">
      {tone === 'green' ? <CheckIcon size={12} /> : tone === 'red' ? <CrossIcon size={12} /> : <span className="h-2 w-2 rounded-full bg-current" />}
    </span>
  )
}

const TONE: Record<string, Tone> = {
  paid: 'green',
  approved: 'green',
  blocked: 'red',
  chain_rejected: 'red',
  changed_alert: 'red',
  key_unrestricted: 'red',
  asked: 'amber',
  over_limit: 'amber',
  unconfirmed: 'amber',
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined)

/** One sentence per event. Presentation only: what happened is decided and recorded by the server. */
function describe(e: OrgEvent, payee: string | undefined): string {
  const d = e.detail ?? {}
  const amount = usd(str(d.amount))
  // full address when there's no name: a lookalike shares its first and last characters with the real wallet
  const to = payee ?? str(d.to) ?? 'a payee'
  const verdict = str(d.verdict) as Verdict | undefined
  switch (e.kind) {
    case 'paid':
      return `Paid ${amount ? `${amount} to ` : ''}${to}`
    case 'blocked': {
      const reason = str(d.reason)
      const why = (reason && BLOCK_REASONS[reason]) ?? (verdict && VERDICTS[verdict] ? VERDICTS[verdict].label : undefined) ?? reason
      return `Blocked ${amount ? `${amount} to ` : ''}${to}${why ? `. ${why}` : ''}`
    }
    case 'chain_rejected':
      return d.broadcast === false
        ? `Tempo refused a payment to ${to} before it was sent${str(d.code) ? ` (${str(d.code)})` : ''}`
        : `Tempo rejected a payment to ${to}${str(d.code) ? ` (${str(d.code)})` : ''}`
    case 'changed_alert': {
      const label = str(d.label) ?? 'A payee'
      const next = str(d.newWallet)
      return `${label} changed its wallet${next ? ` to ${next}` : ''}. Payments stay on hold until you approve the new one.`
    }
    case 'approved':
      return `Approved ${str(d.label) ?? to}. Allowlist updated on Tempo`
    case 'rejected':
      return `Rejected ${str(d.label) ?? to}`
    case 'asked':
      return `Approval requested for ${to}${amount ? ` (${amount})` : ''}`
    case 'over_limit':
      return `${amount ?? 'A payment'} to ${to} is over the agent's spending limit. Pay manually or raise the limit`
    case 'unconfirmed':
      return `Sent ${amount ? `${amount} ` : ''}to ${to}, awaiting confirmation on Tempo`
    case 'preflight_failed':
      return `Tempo's pre-check refused a payment to ${to}${str(d.code) ? ` (${str(d.code)})` : ''}`
    case 'currency_unsupported':
      return `Didn't pay ${to}: the invoice is in ${str(d.currency) || 'an unknown currency'}. Bound pays in USD stablecoins only`
    case 'key_unrestricted':
      return "The agent key has no recipient restriction. Payments are stopped"
    default:
      return e.kind.replace(/_/g, ' ')
  }
}

/** The org's activity: payments, blocks, chain rejections, wallet changes and approvals, newest first. */
export function EventFeed({ events, invoices, pins, className = '' }: { events: OrgEvent[]; invoices: OrgInvoice[]; pins: Pin[]; className?: string }) {
  const [all, setAll] = useState(false)
  const shown = all ? events : events.slice(0, 12)
  const payeeOf = (e: OrgEvent) => {
    const inv = e.invoiceId ? invoices.find((i) => i.id === e.invoiceId) : undefined
    if (inv?.payeeName) return inv.payeeName
    const to = str(e.detail?.to) ?? str(e.detail?.wallet)
    return to ? pins.find((p) => p.wallet.toLowerCase() === to.toLowerCase())?.label : undefined
  }

  return (
    <section className={`${card} min-w-0 ${className}`} aria-labelledby="activity-label">
      <div className="flex items-center justify-between gap-4">
        <h3 id="activity-label" className={cardTitle}>
          Activity
        </h3>
        <Pill live>Live</Pill>
      </div>
      {events.length === 0 ? (
        <p className="mt-6 text-[15px] text-fg2">Nothing yet. Payments, blocks and approvals show up here.</p>
      ) : (
        <ul className="mt-6 flex flex-col">
          {shown.map((e) => {
            const tone = TONE[e.kind] ?? 'grey'
            return (
              <li key={e.id} className="grid grid-cols-[40px_minmax(0,1fr)] items-center gap-4 border-t border-line2 py-4 sm:grid-cols-[40px_minmax(0,1fr)_auto]">
                <EventIcon tone={tone} />
                <div className="min-w-0">
                  <p className="text-[15px] leading-snug text-fg [overflow-wrap:anywhere]">{describe(e, payeeOf(e))}</p>
                  <p className="mt-1 flex flex-wrap gap-x-3 text-[13px] text-fg3">
                    <span className="sm:hidden">{ago(e.createdAt)}</span>
                    {e.detail?.lab === true && <span>Lab</span>}
                    {isTxHash(e.txHash) && (
                      <a href={txUrl(e.txHash)} target="_blank" rel="noreferrer" className={`font-mono text-[12.5px] ${link}`}>
                        {short(e.txHash)} ↗
                      </a>
                    )}
                  </p>
                </div>
                <span className="hidden whitespace-nowrap font-mono text-[12.5px] text-fg3 sm:block">{ago(e.createdAt)}</span>
              </li>
            )
          })}
        </ul>
      )}
      {events.length > 12 && (
        <div className="border-t border-line2 pt-4">
          <button onClick={() => setAll((v) => !v)} className={smallBtn}>
            {all ? 'Show less' : `Show all ${events.length}`}
          </button>
        </div>
      )}
    </section>
  )
}
