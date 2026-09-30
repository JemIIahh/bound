'use client'

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { api, errorMessage, type InvoiceDetail, type OrgEvent, type OrgInvoice, type Payment, type Verdict } from '@/lib/api'
import { txUrl } from '@/lib/chain'
import { ago, usd } from '@/lib/format'
import { AgentLog } from './AgentLog'
import { Amount, ArrowIcon, Avatar, CardFoot, Pill } from './atoms'
import { BLOCK_REASONS, FAIL_REASONS, StatusBadge, invoiceStatus, isOpenStatus } from './InvoiceStatus'
import { Row } from './Row'
import { VERDICTS, VerdictBadge } from './VerdictCard'
import { card, cardTitle, errorText, fieldClass, isTxHash, link, primaryBtn, roundBtn, short, smallBtn } from './ui'

const MAX_PDF_BYTES = 8 * 1024 * 1024

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
    r.onerror = () => reject(r.error ?? new Error("Couldn't read the file"))
    r.readAsDataURL(file)
  })
}

/** Paste or upload an invoice for the agent. `onSubmitted` gets the new invoice's id (its log opens). */
export function InvoiceComposer({ orgId, onSubmitted }: { orgId: string; onSubmitted: (invoiceId: string) => void }) {
  const [text, setText] = useState('')
  const [pdf, setPdf] = useState<{ name: string; base64: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
      onSubmitted(invoiceId)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={`${card} grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:gap-12`} aria-labelledby="invoices-label">
      <div className="flex min-w-0 flex-col">
        <div>
          <Pill>New invoice</Pill>
        </div>
        <h2 id="invoices-label" className={`mt-6 ${cardTitle}`}>
          Send your AI an invoice
        </h2>
        <p className="mt-2 text-[15.5px] leading-[1.55] text-fg2">Paste an invoice or a supplier email, or upload a PDF. The agent checks the payee with Bound before it pays.</p>
      </div>
      <form onSubmit={submit} className="flex min-w-0 flex-col gap-3" noValidate>
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
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <input ref={fileRef} type="file" accept="application/pdf" onChange={pick} className="sr-only" tabIndex={-1} aria-hidden="true" />
            {pdf ? (
              <span className="flex min-w-0 items-center gap-3 font-mono text-[12.5px] text-fg">
                <span className="min-w-0 [overflow-wrap:anywhere]">{pdf.name}</span>
                <button type="button" onClick={() => setPdf(null)} className={`shrink-0 font-sans text-sm text-fg3 ${link}`}>
                  Remove
                </button>
              </span>
            ) : (
              <button type="button" onClick={() => fileRef.current?.click()} className={smallBtn}>
                Upload PDF
              </button>
            )}
          </div>
          <button type="submit" disabled={busy || (!pdf && !text.trim())} className={`${primaryBtn} sm:w-auto`}>
            {busy ? 'Sending…' : 'Send to agent'}
            {!busy && <ArrowIcon />}
          </button>
        </div>
        {error && <p className={errorText}>{error}</p>}
      </form>
    </section>
  )
}

/** Why an invoice ended where it did, from the server's events and payment. */
export function outcome(inv: OrgInvoice, events: OrgEvent[], payment: Payment | undefined) {
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

const FLAG: Partial<Record<Verdict, string>> = { LOOKALIKE: 'lookalike', CHANGED: 'wallet changed', REVOKED: 'revoked' }

/** Which payments filter an invoice belongs to (presentation only). */
export const invoiceGroup = (status: string) => (status === 'awaiting_approval' ? 'approval' : status === 'blocked' ? 'blocked' : status === 'paid' ? 'paid' : 'other')

/** One invoice as a reference-style card; the round arrow opens the agent log (the card then spans the row). */
export function InvoiceCard({
  orgId,
  inv,
  events,
  payment,
  open,
  onToggle,
  hidden = false,
}: {
  orgId: string
  inv: OrgInvoice
  events: OrgEvent[]
  payment: Payment | undefined
  open: boolean
  onToggle: () => void
  hidden?: boolean
}) {
  const amount = usd(inv.amountBase)
  const o = outcome(inv, events, payment)
  const title = inv.payeeName ?? (isOpenStatus(inv.status) ? 'Reading invoice…' : 'Unread invoice')
  const v = inv.verdict?.verdict
  const flag = v ? FLAG[v] : undefined
  const payee = inv.verdict?.payee
  const desc = [inv.invoiceNo, o.text ?? (isOpenStatus(inv.status) ? 'The agent is working on it.' : undefined)].filter(Boolean).join(' · ')
  const m1 = [ago(inv.createdAt), inv.lab ? 'Lab' : null, payee && !flag ? `verified ${payee.domain}` : flag ? 'no verified owner' : inv.senderDomain ? `from ${inv.senderDomain}` : null]
    .filter(Boolean)
    .join(' · ')

  return (
    <article
      className={`${card} flex min-w-0 flex-col gap-8 ${open ? 'col-span-full lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] lg:gap-12' : ''} ${hidden ? '!hidden' : ''}`}
      aria-label={`${title}${inv.invoiceNo ? ` ${inv.invoiceNo}` : ''}`}
    >
      <div className={`flex min-w-0 flex-1 flex-col ${open ? 'lg:self-start' : ''}`}>
        <div className="flex items-center justify-between gap-4">
          <StatusBadge status={inv.status} />
          {amount && <Amount value={amount} />}
        </div>
        <h3 className="mt-8 text-2xl font-semibold leading-[1.15] tracking-[-0.025em] [overflow-wrap:anywhere] sm:text-[26px]">
          {flag ? `“${title}”` : title}
          {flag && <span className="font-medium text-fg3"> — {flag}</span>}
        </h3>
        {(desc || o.tx) && (
          <p className="mt-2 text-[15.5px] leading-[1.55] text-fg2">
            {desc}
            {isTxHash(o.tx) && (
              <>
                {' '}
                <a href={txUrl(o.tx)} target="_blank" rel="noreferrer" className={`whitespace-nowrap font-mono text-[13px] text-fg ${link}`}>
                  {short(o.tx)} ↗
                </a>
              </>
            )}
          </p>
        )}
        <CardFoot
          className={`${open ? '' : 'mt-auto'} pt-8`}
          avatar={<Avatar name={inv.payeeName} flagged={!!flag} />}
          m1={m1}
          m2={inv.address ? short(inv.address) : undefined}
          action={
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={open}
              aria-label={`${open ? 'Hide' : 'Show'} the agent log for ${title}${inv.invoiceNo ? ` ${inv.invoiceNo}` : ''}`}
              className={roundBtn}
            >
              <ArrowIcon />
            </button>
          }
        />
      </div>
      {open && (
        <div className="min-w-0 border-t border-line2 pt-8 lg:border-l lg:border-t-0 lg:pl-12 lg:pt-0">
          {inv.address && (
            <div className="mb-6">
              <Row label="Pays to">{inv.address}</Row>
              {inv.senderDomain && <Row label="Sent from">{inv.senderDomain}</Row>}
            </div>
          )}
          <InvoiceLog orgId={orgId} invoiceId={inv.id} status={inv.status} bare />
        </div>
      )}
    </article>
  )
}

/** The expanded agent log; polls while the invoice is still open. */
export function InvoiceLog({ orgId, invoiceId, status, bare = false }: { orgId: string; invoiceId: string; status: string; /** no divider (sits in its own panel) */ bare?: boolean }) {
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
    <div className={`flex min-w-0 flex-col gap-4 ${bare ? '' : 'mb-4 border-t border-dashed border-line2 pt-4 sm:pl-4'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="text-lg font-semibold tracking-[-0.015em] text-fg">Agent log</h4>
        {detail?.verdict && <VerdictBadge verdict={detail.verdict.verdict} />}
      </div>
      {error && <p className={errorText}>{error}</p>}
      {detail ? (
        detail.agentLog.length || live ? (
          <AgentLog entries={detail.agentLog} live={live} />
        ) : (
          <p className="text-[15px] text-fg3">The agent hasn&apos;t logged anything for this invoice.</p>
        )
      ) : (
        !error && <p className="text-[15px] text-fg3">Loading…</p>
      )}
    </div>
  )
}
