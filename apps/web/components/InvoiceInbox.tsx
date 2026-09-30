'use client'

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { api, errorMessage, type InvoiceDetail, type OrgEvent, type OrgInvoice, type Payment } from '@/lib/api'
import { txUrl } from '@/lib/chain'
import { ago, usd } from '@/lib/format'
import { AgentLog } from './AgentLog'
import { BLOCK_REASONS, FAIL_REASONS, StatusBadge, invoiceStatus, isOpenStatus } from './InvoiceStatus'
import { VERDICTS, VerdictBadge } from './VerdictCard'
import { card, errorText, fieldClass, hint, primaryBtn, sectionLabel, short, smallBtn } from './ui'

const MAX_PDF_BYTES = 8 * 1024 * 1024

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
    r.onerror = () => reject(r.error ?? new Error("Couldn't read the file"))
    r.readAsDataURL(file)
  })
}

/** Paste or upload an invoice for the agent; every invoice with its status and the agent's log. */
export function InvoiceInbox({
  orgId,
  invoices,
  events,
  payments,
  onSubmitted,
}: {
  orgId: string
  invoices: OrgInvoice[]
  events: OrgEvent[]
  payments: Payment[]
  onSubmitted: () => void
}) {
  const [text, setText] = useState('')
  const [pdf, setPdf] = useState<{ name: string; base64: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    if (file.type && file.type !== 'application/pdf') return setError('Choose a PDF file.')
    if (file.size > MAX_PDF_BYTES) return setError('That PDF is larger than 8 MB.')
    try {
      setPdf({ name: file.name, base64: await readBase64(file) })
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const body = pdf ? { pdfBase64: pdf.base64 } : { text }
      const { invoiceId } = await api<{ invoiceId: string }>(`/v1/orgs/${encodeURIComponent(orgId)}/invoices`, { method: 'POST', orgId, json: body })
      setText('')
      setPdf(null)
      setOpen(invoiceId)
      onSubmitted()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={card} aria-labelledby="invoices-label">
      <span id="invoices-label" className={`block ${sectionLabel}`}>
        Invoices
      </span>
      <form onSubmit={submit} className="mt-4 flex flex-col gap-3" noValidate>
        <label htmlFor="invoiceText" className="sr-only">
          Invoice text
        </label>
        <textarea
          id="invoiceText"
          value={pdf ? '' : text}
          onChange={(e) => setText(e.target.value)}
          disabled={!!pdf}
          rows={5}
          placeholder={pdf ? 'PDF attached' : 'Paste an invoice or a supplier email…'}
          className={`${fieldClass} resize-y leading-relaxed disabled:opacity-50`}
        />
        <div className="flex flex-wrap items-center gap-3">
          <input ref={fileRef} type="file" accept="application/pdf" onChange={pick} className="sr-only" tabIndex={-1} aria-hidden="true" />
          {pdf ? (
            <span className="flex min-w-0 items-center gap-2 font-mono text-[12.5px] text-fg">
              <span className="truncate">{pdf.name}</span>
              <button type="button" onClick={() => setPdf(null)} className="shrink-0 text-fg3 underline decoration-fg3/50 underline-offset-4 hover:text-fg">
                Remove
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => fileRef.current?.click()} className={smallBtn}>
              Upload PDF
            </button>
          )}
          <span className={hint}>The agent checks the payee with Bound before it pays.</span>
        </div>
        <button type="submit" disabled={busy || (!pdf && !text.trim())} className={primaryBtn}>
          {busy ? 'Sending…' : 'Send to agent'}
        </button>
        {error && <p className={errorText}>{error}</p>}
      </form>

      <div className="mt-6 border-t border-line2">
        {invoices.length === 0 ? (
          <p className="pt-4 text-sm text-fg3">No invoices yet. The agent verifies every payee before any money moves.</p>
        ) : (
          <ul className="flex flex-col">
            {invoices.map((inv, i) => (
              <InvoiceRow
                key={inv.id}
                orgId={orgId}
                inv={inv}
                first={i === 0}
                events={events}
                payment={payments.find((p) => p.invoiceId === inv.id)}
                open={open === inv.id}
                onToggle={() => setOpen((o) => (o === inv.id ? null : inv.id))}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

/** Why an invoice ended where it did, from the server's events and payment. */
function outcome(inv: OrgInvoice, events: OrgEvent[], payment: Payment | undefined) {
  const own = events.filter((e) => e.invoiceId === inv.id)
  if (inv.status === 'blocked') {
    if (own.some((e) => e.kind === 'chain_rejected')) return { text: 'Rejected onchain by Tempo.', tx: payment?.txHash ?? own.find((e) => e.txHash)?.txHash }
    if (own.some((e) => e.kind === 'rejected')) return { text: 'Rejected by you.' }
    const blocked = own.find((e) => e.kind === 'blocked')
    const reason = typeof blocked?.detail?.reason === 'string' ? blocked.detail.reason : undefined
    if (reason && BLOCK_REASONS[reason]) return { text: `${BLOCK_REASONS[reason]}.` }
    if (inv.verdict) return { text: VERDICTS[inv.verdict.verdict]?.summary }
    return { text: reason }
  }
  if (inv.status === 'failed') {
    const reason = own.map((e) => e.detail?.reason).find((r): r is string => typeof r === 'string' && r in FAIL_REASONS)
    if (reason) return { text: `${FAIL_REASONS[reason]}.` }
  }
  if (inv.status === 'paid') return { text: payment?.txHash ? 'Paid on Tempo.' : undefined, tx: payment?.txHash }
  if (inv.status === 'unconfirmed') return { text: invoiceStatus(inv.status).note, tx: payment?.txHash }
  return { text: invoiceStatus(inv.status).note }
}

function InvoiceRow({
  orgId,
  inv,
  first,
  events,
  payment,
  open,
  onToggle,
}: {
  orgId: string
  inv: OrgInvoice
  first: boolean
  events: OrgEvent[]
  payment: Payment | undefined
  open: boolean
  onToggle: () => void
}) {
  const amount = usd(inv.amountBase)
  const meta = [inv.invoiceNo, amount, ago(inv.createdAt), inv.lab ? 'Lab' : null].filter(Boolean).join(' · ')
  const o = outcome(inv, events, payment)
  const title = inv.payeeName ?? (isOpenStatus(inv.status) ? 'Reading invoice…' : 'Unread invoice')

  return (
    <li className={first ? '' : 'border-t border-line2'}>
      <button onClick={onToggle} aria-expanded={open} className="group flex w-full items-start justify-between gap-4 pt-4 pb-3 text-left">
        <div className="min-w-0">
          <p className="truncate text-sm text-fg group-hover:underline group-hover:decoration-fg3/50 group-hover:underline-offset-4">{title}</p>
          <p className="mt-0.5 truncate font-mono text-[12.5px] text-fg3">{meta}</p>
        </div>
        <StatusBadge status={inv.status} />
      </button>
      {(o.text || o.tx) && (
        <p className="-mt-1 pb-3 text-xs leading-relaxed text-fg3">
          {o.text}
          {o.tx && (
            <>
              {' '}
              <a href={txUrl(o.tx)} target="_blank" rel="noreferrer" className="font-mono text-[12.5px] underline decoration-fg3/50 underline-offset-4 hover:text-fg">
                {short(o.tx)} ↗
              </a>
            </>
          )}
        </p>
      )}
      {open && <InvoiceLog orgId={orgId} invoiceId={inv.id} status={inv.status} />}
    </li>
  )
}

/** The expanded agent log; polls while the invoice is still open. */
function InvoiceLog({ orgId, invoiceId, status }: { orgId: string; invoiceId: string; status: string }) {
  const [detail, setDetail] = useState<InvoiceDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const live = isOpenStatus(detail?.status ?? status)

  useEffect(() => {
    let stopped = false
    const load = () =>
      api<InvoiceDetail>(`/v1/orgs/${encodeURIComponent(orgId)}/invoices/${encodeURIComponent(invoiceId)}`, { orgId })
        .then((d) => !stopped && (setDetail(d), setError(null)))
        .catch((e) => !stopped && setError(errorMessage(e)))
    void load()
    if (!live) return () => void (stopped = true)
    const t = setInterval(load, 3000)
    return () => {
      stopped = true
      clearInterval(t)
    }
    // re-subscribe when the invoice settles (status from the overview poll) so the final log lines load once
  }, [orgId, invoiceId, live, status])

  return (
    <div className="mb-4 flex flex-col gap-4 border-t border-dashed border-line2 pt-4 sm:pl-4">
      {detail?.verdict && (
        <div>
          <VerdictBadge verdict={detail.verdict.verdict} />
        </div>
      )}
      <span className={sectionLabel}>Agent log</span>
      {error && <p className={errorText}>{error}</p>}
      {detail ? (
        detail.agentLog.length || live ? (
          <AgentLog entries={detail.agentLog} live={live} />
        ) : (
          <p className="text-sm text-fg3">The agent hasn&apos;t logged anything for this invoice.</p>
        )
      ) : (
        !error && <p className="text-sm text-fg3">Loading…</p>
      )}
    </div>
  )
}
