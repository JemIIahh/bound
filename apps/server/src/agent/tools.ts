import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod'
// betaZodTool converts schemas with zod v4's toJSONSchema, so tool schemas must be zod v4 schemas.
import * as z from 'zod/v4'
import { getAddress, isAddress, isHex, type Address, type Hex } from 'viem'
import { eq } from 'drizzle-orm'
import { memoFromInvoice, normalizeDomain, parseAmount } from '@bound/core'
import { newId } from '../crypto'
import { invoices, orgs, payments } from '../db/schema'
import { logEvent, nowSeconds } from '../services/events'
import { withOrgLock } from '../services/mutex'
import { isUniqueViolation, payInvoice, PaymentNotSent, type ServiceDeps } from '../services/payments'
import { verifyPayee } from '../services/verify-service'

export type AgentMode = 'guarded' | 'guard_off'
export type ToolResultSink = (name: string, result: unknown) => void

const fields = z.object({
  payeeName: z.string().max(300).describe('Supplier name as written on the invoice'),
  address: z.string().max(100).describe('Payment address on the invoice (0x…)'),
  amount: z.string().max(40).describe('Amount as written, e.g. "1,250.50"'),
  currency: z.string().max(20).describe('Currency as written, e.g. USDC'),
  invoiceNo: z.string().max(100).describe('Invoice number or reference'),
  senderDomain: z.string().max(320).optional().describe('Domain of the sender email address, if visible'),
  dueDate: z.string().max(40).optional().describe('Due date as written, if visible'),
})
type Fields = z.infer<typeof fields>

/** Invoice statuses in which the agent may still (re)write what it read from the invoice. */
const EDITABLE = new Set(['new', 'processing'])
/** Payment states that mean money may have moved (or is moving). */
const MONEY_MAY_HAVE_MOVED = new Set(['submitting', 'confirmed', 'unknown'])

const loadInvoice = (deps: Pick<ServiceDeps, 'db'>, invoiceId: string) => deps.db.select().from(invoices).where(eq(invoices.id, invoiceId)).get()
const loadPayment = (deps: Pick<ServiceDeps, 'db'>, invoiceId: string) => deps.db.select().from(payments).where(eq(payments.invoiceId, invoiceId)).get()
const setInvoice = (deps: Pick<ServiceDeps, 'db'>, invoiceId: string, v: Partial<typeof invoices.$inferInsert>) =>
  deps.db.update(invoices).set(v).where(eq(invoices.id, invoiceId)).run()

function positiveAmount(raw: string): { ok: true; amount: bigint } | { ok: false; error: string } {
  try {
    const amount = parseAmount(raw)
    return amount > 0n ? { ok: true, amount } : { ok: false, error: 'Amount must be greater than zero' }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** Stores the fields the agent read from the (untrusted) invoice. Locked once the invoice is decided or a payment exists. */
export async function recordInvoiceFields(deps: Pick<ServiceDeps, 'db'>, invoiceId: string, f: Fields) {
  const inv = loadInvoice(deps, invoiceId)
  if (!inv) return { ok: false as const, error: 'Invoice not found' }
  if (!EDITABLE.has(inv.status) || loadPayment(deps, invoiceId)) {
    return { ok: false as const, error: `Invoice is already ${inv.status}; its fields can no longer change` }
  }
  const payeeName = f.payeeName.trim()
  if (!payeeName) return { ok: false as const, error: 'Payee name is empty' }
  if (!isAddress(f.address.trim())) return { ok: false as const, error: 'Payment address is not a valid 0x address' }
  const amt = positiveAmount(f.amount)
  if (!amt.ok) return { ok: false as const, error: amt.error }
  const senderDomain = f.senderDomain ? normalizeDomain(f.senderDomain) || null : null
  setInvoice(deps, invoiceId, {
    payeeName, address: getAddress(f.address.trim()), amountBase: amt.amount.toString(), currency: f.currency.trim(),
    invoiceNo: f.invoiceNo.trim(), senderDomain, dueDate: f.dueDate?.trim() || null, status: 'processing',
  })
  return { ok: true as const, amountBase: amt.amount.toString() }
}

type RawTransferResult =
  | { ok: false; error: string; txHash?: string }
  | { ok: false; chain: 'not_sent'; reason: string }
  | { ok: false; chain: 'not_sent'; code: string; error: string }
  | { ok: false; chain: 'rejected'; code: string; txHash: Hex }
  | { ok: false; chain: 'unknown'; error: string; txHash?: Hex }
  | { ok: true; chain: 'accepted'; txHash: Hex }

export type RawTransferOptions = { receiptTimeoutMs?: number; receiptPollMs?: number }

export const LAB_GATE_REASON = 'lab only force-sends payments Tempo will refuse'
/** Upper bound on waiting for the receipt of a possibly-broadcast lab transfer. */
const RECEIPT_TIMEOUT_MS = 60_000
const RECEIPT_POLL_MS = 2_000

/** `limitBase` is the key's FULL per-period spending limit (null if unreadable). */
type LabTransfer = { orgId: string; invoiceId: string; to: Address; amount: bigint; memo: Hex; limitBase: bigint | null }

/**
 * The lab force-sends only what Tempo is certain to refuse at execution:
 * - CallNotAllowed: the recipient is outside the key's allowlist (no time-dependent state);
 * - SpendingLimitExceeded only when the amount exceeds the FULL per-period limit. A smaller amount
 *   could succeed if the limit period rolls over (refills) between preflight and execution.
 */
function tempoWillRefuse(pre: { ok: false; code: string }, t: LabTransfer): boolean {
  if (pre.code === 'CallNotAllowed') return true
  return pre.code === 'SpendingLimitExceeded' && t.limitBase !== null && t.amount > t.limitBase
}

const parseBase = (v: string): bigint | null => {
  try { return BigInt(v) } catch { return null }
}
type Locked = { kind: 'done'; result: RawTransferResult } | { kind: 'maybe_sent'; paymentId: string; txHash?: Hex; code?: string }

/**
 * ATTACK LAB ONLY ("guard off"): Bound's payee checks are off, so the demo can show Tempo itself
 * refusing the payment. Safety rails that stay on:
 * - lab invoices of an authorized org only, and at most one transfer per invoice;
 * - it broadcasts ONLY when Tempo is certain to refuse it: preflight CallNotAllowed, or
 *   SpendingLimitExceeded for an amount above the full per-period limit (tempoWillRefuse). A payment
 *   Tempo would or might accept (or an unknown preflight) is never sent, so the lab cannot move funds;
 * - the send is forced (no simulation) so the refusal is a mined, reverted tx with a public hash;
 * - it runs under the per-org lock (no nonce race with payInvoice); the lock is not re-entrant,
 *   so nothing inside it may call payInvoice. A possibly-broadcast outcome is recorded as 'unknown'
 *   with its hash inside the lock (crash-safe), then settled after the lock is released by a bounded
 *   (≤ 60 s) receipt wait.
 */
export async function rawTransfer(deps: ServiceDeps, invoiceId: string, p: { to: string; amount: string; memo: string }, opts: RawTransferOptions = {}): Promise<RawTransferResult> {
  const inv = loadInvoice(deps, invoiceId)
  if (!inv || inv.lab !== 1) return { ok: false, error: 'raw_transfer is only available in the attack lab' }
  const org = deps.db.select().from(orgs).where(eq(orgs.id, inv.orgId)).get()
  if (!org?.authorized) return { ok: false, error: 'The org has not authorized its agent key yet' }
  if (!isAddress(p.to.trim())) return { ok: false, error: 'bad address' }
  const to = getAddress(p.to.trim()) as Address
  const amt = positiveAmount(p.amount)
  if (!amt.ok) return { ok: false, error: amt.error }
  const t: LabTransfer = {
    orgId: inv.orgId, invoiceId, to, amount: amt.amount, limitBase: parseBase(org.limitBase),
    memo: memoFromInvoice(p.memo.trim() || inv.invoiceNo?.trim() || inv.id),
  }

  const out = await withOrgLock(t.orgId, () => rawTransferLocked(deps, t))
  return out.kind === 'done' ? out.result : settleMaybeSent(deps, t, out, opts)
}

const labDetail = (t: LabTransfer) => ({ to: t.to, amount: t.amount.toString(), lab: true, guardOff: true })
const setPayment = (deps: ServiceDeps, paymentId: string, v: Partial<typeof payments.$inferInsert>) =>
  deps.db.update(payments).set(v).where(eq(payments.id, paymentId)).run()

function recordRejected(deps: ServiceDeps, t: LabTransfer, paymentId: string, txHash: Hex, code: string): RawTransferResult {
  setPayment(deps, paymentId, { status: 'reverted', txHash })
  setInvoice(deps, t.invoiceId, { status: 'blocked' })
  logEvent(deps.db, { orgId: t.orgId, kind: 'chain_rejected', invoiceId: t.invoiceId, txHash, detail: { ...labDetail(t), code } })
  return { ok: false, chain: 'rejected', code, txHash }
}

function recordPaid(deps: ServiceDeps, t: LabTransfer, paymentId: string, txHash: Hex): RawTransferResult {
  setPayment(deps, paymentId, { status: 'confirmed', txHash })
  setInvoice(deps, t.invoiceId, { status: 'paid' })
  logEvent(deps.db, { orgId: t.orgId, kind: 'paid', invoiceId: t.invoiceId, txHash, detail: labDetail(t) })
  return { ok: true, chain: 'accepted', txHash }
}

/** Outcome still unknown: keep the payment 'unknown' (reconcilable by hash) and make the invoice visibly 'unconfirmed'. */
function recordUnconfirmed(deps: ServiceDeps, t: LabTransfer, paymentId: string, txHash?: Hex): RawTransferResult {
  setPayment(deps, paymentId, { status: 'unknown', txHash: txHash ?? null })
  setInvoice(deps, t.invoiceId, { status: 'unconfirmed' })
  logEvent(deps.db, { orgId: t.orgId, kind: 'unconfirmed', invoiceId: t.invoiceId, txHash: txHash ?? null, detail: labDetail(t) })
  return { ok: false, chain: 'unknown', error: 'Outcome unknown: no receipt yet', ...(txHash ? { txHash } : {}) }
}

async function rawTransferLocked(deps: ServiceDeps, t: LabTransfer): Promise<Locked> {
  const { orgId, invoiceId, to, amount, memo } = t
  // Claim the invoice's single payment slot (unique index) before anything goes on chain.
  const paymentId = newId('pay')
  try {
    deps.db.insert(payments).values({ id: paymentId, orgId, invoiceId, toAddress: to, amountBase: amount.toString(), memo, txHash: null, status: 'submitting', createdAt: nowSeconds() }).run()
  } catch (e) {
    if (!isUniqueViolation(e)) throw e
    const prior = loadPayment(deps, invoiceId)
    return { kind: 'done', result: { ok: false, error: 'A transfer was already attempted for this invoice', ...(prior?.txHash ? { txHash: prior.txHash } : {}) } }
  }

  let pre: { ok: true } | { ok: false; code: string; message: string } | null = null
  try { pre = await deps.ops.preflight({ orgId, to, amount, memo }) } catch (e) { console.error('[lab] preflight errored', invoiceId, e) }
  if (!pre || pre.ok || !tempoWillRefuse(pre, t)) {
    // Tempo would or might accept this payment (or we cannot tell): the lab never sends it.
    setPayment(deps, paymentId, { status: 'rejected' })
    setInvoice(deps, invoiceId, { status: 'blocked' })
    logEvent(deps.db, { orgId, kind: 'blocked', invoiceId, detail: { ...labDetail(t), reason: 'lab_gate', preflight: pre ? (pre.ok ? 'ok' : pre.code) : 'error' } })
    return { kind: 'done', result: { ok: false, chain: 'not_sent', reason: LAB_GATE_REASON } }
  }
  const code = pre.code

  let sent: { txHash: Hex; status: 'success' | 'reverted' }
  try {
    sent = await deps.ops.send({ orgId, to, amount, memo, force: true })
  } catch (e) {
    if (e instanceof PaymentNotSent) {
      setPayment(deps, paymentId, { status: 'rejected' })
      setInvoice(deps, invoiceId, { status: 'failed' })
      logEvent(deps.db, { orgId, kind: 'chain_rejected', invoiceId, detail: { ...labDetail(t), code: e.code, broadcast: false } })
      return { kind: 'done', result: { ok: false, chain: 'not_sent', code: e.code, error: 'The transfer was not broadcast' } }
    }
    console.error('[lab] raw transfer outcome unknown', invoiceId, e)
    const maybe = (e as { txHash?: unknown } | null)?.txHash
    return maybeSent(deps, paymentId, code, typeof maybe === 'string' && isHex(maybe) ? maybe : undefined)
  }

  // Explicit mapping, as in payInvoice: only 'reverted' is a chain rejection and only 'success' moved money.
  if (sent?.status === 'reverted') return { kind: 'done', result: recordRejected(deps, t, paymentId, sent.txHash, code) }
  if (sent?.status === 'success') return { kind: 'done', result: recordPaid(deps, t, paymentId, sent.txHash) } // defensive: the gate should prevent this
  console.error('[lab] unrecognised send result; treating as unknown', invoiceId, sent)
  const hash = sent?.txHash
  return maybeSent(deps, paymentId, code, typeof hash === 'string' && isHex(hash) ? hash : undefined)
}

/** Persist "possibly sent" with its hash while still holding the lock (crash-safe), then settle outside it. */
function maybeSent(deps: ServiceDeps, paymentId: string, code: string, txHash: Hex | undefined): Locked {
  setPayment(deps, paymentId, { status: 'unknown', txHash: txHash ?? null })
  return { kind: 'maybe_sent', paymentId, code, ...(txHash ? { txHash } : {}) }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** Resolves to null if `p` does not settle within `ms` (or rejects). */
const within = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), Math.max(0, ms)))])

/** Bounded wait for the receipt of a possibly-broadcast lab transfer (runs outside the org lock). */
async function settleMaybeSent(deps: ServiceDeps, t: LabTransfer, m: Extract<Locked, { kind: 'maybe_sent' }>, opts: RawTransferOptions): Promise<RawTransferResult> {
  if (!m.txHash) return recordUnconfirmed(deps, t, m.paymentId)
  const timeout = Math.min(opts.receiptTimeoutMs ?? RECEIPT_TIMEOUT_MS, RECEIPT_TIMEOUT_MS)
  const poll = opts.receiptPollMs ?? RECEIPT_POLL_MS
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const st = await within(deps.ops.getReceipt(m.txHash), deadline - Date.now())
    if (st === 'reverted') return recordRejected(deps, t, m.paymentId, m.txHash, m.code ?? 'Reverted')
    if (st === 'success') return recordPaid(deps, t, m.paymentId, m.txHash)
    await sleep(Math.min(poll, Math.max(0, deadline - Date.now())))
  }
  return recordUnconfirmed(deps, t, m.paymentId, m.txHash)
}

/** The stored verdict's reasons, so pay/approval results carry them verbatim to the model and the log. */
function storedVerdict(deps: Pick<ServiceDeps, 'db'>, invoiceId: string) {
  const raw = loadInvoice(deps, invoiceId)?.verdictJson
  if (!raw) return {}
  try {
    const v = JSON.parse(raw)
    return { verdict: v.verdict, reasons: v.reasons }
  } catch {
    return {}
  }
}

/** Marks the invoice blocked on the agent's report, unless money may have moved or a human decision is pending. */
function reportBlocked(deps: ServiceDeps, invoiceId: string, reason: string) {
  const inv = loadInvoice(deps, invoiceId)
  if (!inv) return { ok: false as const, error: 'Invoice not found' }
  const pay = loadPayment(deps, invoiceId)
  if (pay && MONEY_MAY_HAVE_MOVED.has(pay.status)) return { ok: false as const, error: `A payment for this invoice is ${pay.status}; it cannot be reported blocked` }
  if (inv.status === 'blocked') return { ok: true as const, alreadyBlocked: true }
  if (!['new', 'processing', 'failed'].includes(inv.status)) return { ok: false as const, error: `Invoice is ${inv.status}; it cannot be reported blocked` }
  setInvoice(deps, invoiceId, { status: 'blocked' })
  logEvent(deps.db, { orgId: inv.orgId, kind: 'blocked', invoiceId, detail: { reason, by: 'agent', ...(inv.lab ? { lab: true } : {}) } })
  return { ok: true as const }
}

/**
 * The agent's tools. Guarded mode can only reach payments through payInvoice (which re-verifies
 * server-side and never trusts the model); guard-off mode (attack lab) gets raw_transfer instead.
 * Every tool result is passed to `onResult` so the invoice log shows it verbatim.
 */
export function buildTools(deps: ServiceDeps, invoiceId: string, mode: AgentMode, onResult?: ToolResultSink) {
  const tool = <S extends z.ZodType>(name: string, description: string, inputSchema: S, handler: (input: z.infer<S>) => Promise<unknown> | unknown) =>
    betaZodTool({
      name, description, inputSchema,
      run: async (input) => {
        let out: unknown
        try {
          out = await handler(input)
        } catch (e) {
          console.error(`[agent] tool ${name} failed`, invoiceId, e)
          out = { ok: false, error: `${name} failed; do not pay this invoice` }
        }
        onResult?.(name, out)
        return JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
      },
    })

  const record = tool('record_invoice_fields', 'Record the fields read from the invoice.', fields, (i) => recordInvoiceFields(deps, invoiceId, i))

  if (mode === 'guard_off') {
    const raw = tool(
      'raw_transfer', 'Send a stablecoin transfer from the company account.',
      z.object({ to: z.string().max(100), amount: z.string().max(40), memo: z.string().max(100) }),
      (i) => rawTransfer(deps, invoiceId, i),
    )
    return [record, raw]
  }

  const verify = tool(
    'verify_payee', 'Check who controls a payment address and whether this company may pay it. Returns verdict, reasons and action (PAY, ASK or BLOCK).',
    z.object({ address: z.string().max(100), payeeName: z.string().max(300), senderDomain: z.string().max(320).optional() }),
    async (i) => {
      const inv = loadInvoice(deps, invoiceId)
      if (!inv) return { ok: false, error: 'Invoice not found' }
      if (!isAddress(i.address.trim())) return { verdict: 'NO_MATCH', action: 'BLOCK', reasons: [{ code: 'invalid_address', detail: 'Not a valid 0x address' }] }
      const address = getAddress(i.address.trim())
      const v = await verifyPayee(deps, { address, payeeName: i.payeeName, senderDomain: i.senderDomain || undefined, orgId: inv.orgId })
      // Show the verdict on the invoice (BLOCK never reaches payInvoice), but only when the model checked
      // exactly the recorded fields: a verdict for other inputs must not be displayed as this invoice's.
      const senderDomain = i.senderDomain ? normalizeDomain(i.senderDomain) || null : null
      const sameFields = inv.address === address && inv.payeeName === i.payeeName.trim() && (inv.senderDomain ?? null) === senderDomain
      if (sameFields && EDITABLE.has(inv.status)) {
        setInvoice(deps, invoiceId, { verdictJson: JSON.stringify(v), action: v.action })
      }
      return v
    },
  )
  const pay = tool(
    'pay_invoice', 'Pay the recorded invoice. Bound re-checks the payee and only pays approved, verified payees.',
    z.object({}),
    async () => ({ ...(await payInvoice(deps, invoiceId)), ...storedVerdict(deps, invoiceId) }),
  )
  const ask = tool(
    'request_payee_approval', 'Ask the finance lead to approve this payee before paying. Bound re-checks the payee first: a blocked payee is refused.',
    z.object({ note: z.string().max(1000).optional() }),
    // payInvoice routes ASK verdicts into an approval request (and re-verifies, so it never trusts the model's call)
    async () => ({ ...(await payInvoice(deps, invoiceId)), ...storedVerdict(deps, invoiceId) }),
  )
  const block = tool(
    'report_blocked', 'Report that this invoice must not be paid and why.',
    z.object({ reason: z.string().max(2000) }),
    (i) => reportBlocked(deps, invoiceId, i.reason),
  )
  return [record, verify, pay, ask, block]
}
