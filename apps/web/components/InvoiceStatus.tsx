import type { InvoiceStatus } from '@/lib/api'
import { Pill } from './atoms'
import { Badge, type Tone } from './VerdictCard'

/** How each invoice status reads. The status itself always comes from the API. */
export const INVOICE_STATUS: Record<InvoiceStatus, { label: string; tone: Tone; note?: string }> = {
  new: { label: 'Queued', tone: 'grey' },
  processing: { label: 'Agent working', tone: 'grey' },
  awaiting_approval: { label: 'Needs approval', tone: 'amber', note: 'Waiting for you to approve the payee.' },
  over_limit: { label: 'Over limit', tone: 'amber', note: "Over the agent's spending limit — pay manually or raise the limit." },
  paid: { label: 'Paid', tone: 'green' },
  blocked: { label: 'Blocked', tone: 'red' },
  failed: { label: 'Failed', tone: 'grey', note: 'Not paid. Open the log for details.' },
  unconfirmed: { label: 'Unconfirmed', tone: 'amber', note: 'Sent, awaiting confirmation on Tempo.' },
}

export const invoiceStatus = (s: string) => INVOICE_STATUS[s as InvoiceStatus] ?? { label: s, tone: 'grey' as Tone }

/** True while the agent (or a send) may still change the invoice. */
export const isOpenStatus = (s: string) => s === 'new' || s === 'processing' || s === 'unconfirmed'

export function StatusBadge({ status }: { status: string }) {
  const s = invoiceStatus(status)
  if (status === 'new' || status === 'processing') return <Pill dot="bg-current live-dot">{s.label}</Pill>
  return <Badge tone={s.tone}>{s.label}</Badge>
}

/** Plain-language reasons the server records when it refuses to pay (payInvoice `reason`, event detail.reason). */
export const FAIL_REASONS: Record<string, string> = {
  currency_unsupported: 'Unsupported currency — Bound pays in USD stablecoins only',
}

/** Plain-language reasons the server records on blocked events. */
export const BLOCK_REASONS: Record<string, string> = {
  duplicate_invoice: 'Already paid: duplicate invoice',
  rejected_by_approver: 'Rejected by you',
  lab_gate: 'Not sent — the lab only fires payments Tempo will refuse',
}
