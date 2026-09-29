'use client'

import { useState } from 'react'
import type { OrgEvent, OrgInvoice, Pin, Verdict } from '@/lib/api'
import { txUrl } from '@/lib/chain'
import { ago, usd } from '@/lib/format'
import { BLOCK_REASONS } from './InvoiceStatus'
import { VERDICTS, type Tone } from './VerdictCard'
import { card, sectionLabel, short, smallBtn } from './ui'

const DOT: Record<Tone, string> = { green: 'bg-emerald-600', amber: 'bg-amber-500', grey: 'bg-graphite', red: 'bg-red-600' }

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
export function EventFeed({ events, invoices, pins }: { events: OrgEvent[]; invoices: OrgInvoice[]; pins: Pin[] }) {
  const [all, setAll] = useState(false)
  const shown = all ? events : events.slice(0, 12)
  const payeeOf = (e: OrgEvent) => {
    const inv = e.invoiceId ? invoices.find((i) => i.id === e.invoiceId) : undefined
    if (inv?.payeeName) return inv.payeeName
    const to = str(e.detail?.to) ?? str(e.detail?.wallet)
    return to ? pins.find((p) => p.wallet.toLowerCase() === to.toLowerCase())?.label : undefined
  }

  return (
    <section className={card} aria-labelledby="activity-label">
      <span id="activity-label" className={`block ${sectionLabel}`}>
        Activity
      </span>
      {events.length === 0 ? (
        <p className="mt-3 text-sm text-graphite">Nothing yet. Payments, blocks and approvals show up here.</p>
      ) : (
        <ul className="mt-3 flex flex-col">
          {shown.map((e, i) => (
            <li key={e.id} className={`flex gap-3 py-3 ${i ? 'border-t border-black/10' : ''}`}>
              <span className={`mt-[7px] inline-block h-1.5 w-1.5 shrink-0 rounded-full ${DOT[TONE[e.kind] ?? 'grey']}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-relaxed text-ink [overflow-wrap:anywhere]">{describe(e, payeeOf(e))}</p>
                <p className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-[11px] text-graphite">
                  <span>{ago(e.createdAt)}</span>
                  {e.detail?.lab === true && <span>Lab</span>}
                  {e.txHash && (
                    <a href={txUrl(e.txHash)} target="_blank" rel="noreferrer" className="underline decoration-black/30 underline-offset-4 hover:text-ink">
                      {short(e.txHash)} ↗
                    </a>
                  )}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {events.length > 12 && (
        <div className="mt-2 border-t border-black/10 pt-4">
          <button onClick={() => setAll((v) => !v)} className={smallBtn}>
            {all ? 'Show less' : `Show all ${events.length}`}
          </button>
        </div>
      )}
    </section>
  )
}
