import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod'
// betaZodTool converts schemas with zod v4's toJSONSchema, so tool schemas must be zod v4 schemas.
import * as z from 'zod/v4'
import { getAddress, isAddress, isHex, type Address, type Hex } from 'viem'
import { eq } from 'drizzle-orm'
import { memoFromInvoice, normalizeDomain, parseAmount } from '@bound/core'
import { newId } from '../crypto'
import { invoices, payments } from '../db/schema'
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
  | { ok: false; chain: 'rejected'; code: string; txHash: Hex }
  | { ok: false; chain: 'not_sent'; code: string; error: string }
  | { ok: false; chain: 'unknown'; error: string; txHash?: Hex }
  | { ok: true; chain: 'accepted'; txHash: Hex }

/**
 * ATTACK LAB ONLY ("guard off"): sends the transfer the model asked for with Bound's checks off.
 * No payee verification, no preflight gate: the signed transaction is broadcast with a fixed gas
 * limit (no simulation), so Tempo's keychain is the only thing that can stop it. At most one
 * transfer per lab invoice. The preflight result is used only to name the chain's reason (a mined
 * receipt carries no revert reason).
 */
export async function rawTransfer(deps: ServiceDeps, invoiceId: string, p: { to: string; amount: string; memo: string }): Promise<RawTransferResult> {
  const inv = loadInvoice(deps, invoiceId)
  if (!inv || inv.lab !== 1) return { ok: false, error: 'raw_transfer is only available in the attack lab' }
  if (!isAddress(p.to.trim())) return { ok: false, error: 'bad address' }
  const to = getAddress(p.to.trim()) as Address
  const amt = positiveAmount(p.amount)
  if (!amt.ok) return { ok: false, error: amt.error }
  const amount = amt.amount
  const memo = memoFromInvoice(p.memo.trim() || inv.invoiceNo?.trim() || inv.id)

  // Same per-org lock as payInvoice: the forced send must not race the agent key's nonce with a real
  // payment. The lock is not re-entrant, so nothing in here may call payInvoice.
  return withOrgLock(inv.orgId, () => rawTransferLocked(deps, { orgId: inv.orgId, invoiceId, to, amount, memo }))
}

async function rawTransferLocked(deps: ServiceDeps, p: { orgId: string; invoiceId: string; to: Address; amount: bigint; memo: Hex }): Promise<RawTransferResult> {
  const { orgId, invoiceId, to, amount, memo } = p
  // Claim the invoice's single payment slot (unique index) before anything goes on chain.
  const paymentId = newId('pay')
  try {
    deps.db.insert(payments).values({ id: paymentId, orgId, invoiceId, toAddress: to, amountBase: amount.toString(), memo, txHash: null, status: 'submitting', createdAt: nowSeconds() }).run()
  } catch (e) {
    if (!isUniqueViolation(e)) throw e
    const prior = loadPayment(deps, invoiceId)
    return { ok: false, error: 'A transfer was already attempted for this invoice', ...(prior?.txHash ? { txHash: prior.txHash } : {}) }
  }
  const setPayment = (v: Partial<typeof payments.$inferInsert>) => deps.db.update(payments).set(v).where(eq(payments.id, paymentId)).run()
  const detail = { to, amount: amount.toString(), lab: true, guardOff: true }

  let pre: { ok: true } | { ok: false; code: string; message: string } | null = null
  try { pre = await deps.ops.preflight({ orgId, to, amount, memo }) } catch { pre = null }
  const code = pre && !pre.ok ? pre.code : undefined

  const unknown = (txHash: Hex | undefined): RawTransferResult => {
    setPayment({ status: 'unknown', txHash: txHash ?? null })
    setInvoice(deps, invoiceId, { status: 'processing' })
    return { ok: false, chain: 'unknown', error: 'Outcome unknown (RPC error after broadcast)', ...(txHash ? { txHash } : {}) }
  }

  let sent: { txHash: Hex; status: 'success' | 'reverted' }
  try {
    sent = await deps.ops.send({ orgId, to, amount, memo, force: true })
  } catch (e) {
    if (e instanceof PaymentNotSent) {
      setPayment({ status: 'rejected' })
      setInvoice(deps, invoiceId, { status: 'failed' })
      logEvent(deps.db, { orgId, kind: 'chain_rejected', invoiceId, detail: { ...detail, code: e.code, broadcast: false } })
      return { ok: false, chain: 'not_sent', code: e.code, error: 'The transfer was not broadcast' }
    }
    console.error('[lab] raw transfer outcome unknown', invoiceId, e)
    const maybe = (e as { txHash?: unknown } | null)?.txHash
    return unknown(typeof maybe === 'string' && isHex(maybe) ? maybe : undefined)
  }

  // Explicit mapping, as in payInvoice: only 'reverted' is a chain rejection and only 'success' moved money.
  if (sent?.status === 'reverted') {
    const reason = code ?? 'Reverted'
    setPayment({ status: 'reverted', txHash: sent.txHash })
    setInvoice(deps, invoiceId, { status: 'blocked' })
    logEvent(deps.db, { orgId, kind: 'chain_rejected', invoiceId, txHash: sent.txHash, detail: { ...detail, code: reason } })
    return { ok: false, chain: 'rejected', code: reason, txHash: sent.txHash }
  }
  if (sent?.status === 'success') {
    setPayment({ status: 'confirmed', txHash: sent.txHash })
    setInvoice(deps, invoiceId, { status: 'paid' })
    logEvent(deps.db, { orgId, kind: 'paid', invoiceId, txHash: sent.txHash, detail })
    return { ok: true, chain: 'accepted', txHash: sent.txHash }
  }
  console.error('[lab] unrecognised send result; treating as unknown', invoiceId, sent)
  const hash = sent?.txHash
  return unknown(typeof hash === 'string' && isHex(hash) ? hash : undefined)
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
      // Show the verdict on the invoice when it is about the recorded payment address (BLOCK never reaches payInvoice).
      if (inv.address && inv.address.toLowerCase() === address.toLowerCase() && EDITABLE.has(inv.status)) {
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
