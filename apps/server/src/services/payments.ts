import {
  createClient, getAddress, http, isHex, publicActions, TransactionReceiptNotFoundError, walletActions,
  type Address, type Hex,
} from 'viem'
import { Abis, Account } from 'viem/tempo'
import { and, eq, inArray } from 'drizzle-orm'
import {
  agentAccount, getNetwork, KEYCHAIN, memoFromInvoice, payWithKey, PaymentOutcomeUnknown, PaymentRejected, preflightPay,
  readAllowlist, readKey, readPayee, resolveRecipient, type OnchainPayee,
} from '@bound/core'
import type { AppDeps } from '../app'
import { decryptSecret, newId } from '../crypto'
import type { Db } from '../db/client'
import { approvals, invoices, orgs, payments } from '../db/schema'
import { requestApproval } from './approvals'
import { logEvent, nowSeconds } from './events'
import { verifyPayee, type VerifyOutput } from './verify-service'

/** Every chain interaction the services need, injected so tests run offline. */
export type ChainOps = {
  resolveRecipient: (to: Address) => Promise<{ effective: Address; isVirtual: boolean; masterId: Hex | null; registered: boolean }>
  /** Throws AllowlistError('unrestricted: …') when the key could pay anyone. */
  readAllowlist: (account: Address, keyId: Address) => Promise<Address[]>
  preflight: (p: { orgId: string; to: Address; amount: bigint; memo: Hex }) => Promise<{ ok: true } | { ok: false; code: string; message: string }>
  /**
   * Throws PaymentNotSent when nothing was broadcast. Any other throw means the outcome is unknown;
   * if the error carries `txHash` (PaymentOutcomeUnknown) it identifies the possibly-broadcast tx.
   */
  send: (p: { orgId: string; to: Address; amount: bigint; memo: Hex; force?: boolean }) => Promise<{ txHash: Hex; status: 'success' | 'reverted' }>
  waitReceipt: (hash: Hex) => Promise<{ status: 'success' | 'reverted' }>
  /** Non-blocking receipt lookup: null when the node has no receipt (pending, dropped, or never sent). */
  getReceipt: (hash: Hex) => Promise<'success' | 'reverted' | null>
  findPaymentByMemo: (orgId: string, memo: Hex, match?: { to: Address; amount: bigint }) => Promise<Hex | null>
  /** Onchain registry read, used when the local mirror has no record for a wallet. */
  readPayee: (wallet: Address) => Promise<OnchainPayee | null>
  readKey: (account: Address, keyId: Address) => Promise<{ expiry: bigint; enforceLimits: boolean; isRevoked: boolean }>
  remainingLimit: (account: Address, keyId: Address) => Promise<bigint>
  /** Demo only: signs and sends a call with DEMO_ROOT_PRIVATE_KEY. */
  sendDemoRoot: (call: { to: Address; data: Hex }) => Promise<Hex>
}

export type ServiceDeps = AppDeps & { ops: ChainOps }

/** The payment was definitely not broadcast (safe to retry after re-verification). */
export class PaymentNotSent extends Error {
  constructor(public code: string, message: string) {
    super(message)
    this.name = 'PaymentNotSent'
  }
}

export type PayResult = { status: 'paid' | 'asked' | 'blocked' | 'failed'; txHash?: Hex; reason?: string; approvalId?: string }

type InvoiceRow = typeof invoices.$inferSelect
type PaymentRow = typeof payments.$inferSelect

const setInvoice = (db: Db, id: string, v: Partial<InvoiceRow>) => db.update(invoices).set(v).where(eq(invoices.id, id)).run()

function markPaid(db: Db, row: Pick<PaymentRow, 'id' | 'orgId' | 'invoiceId' | 'toAddress' | 'amountBase'>, txHash: Hex, lab: boolean) {
  const res = db.update(payments).set({ status: 'confirmed', txHash })
    .where(and(eq(payments.id, row.id), inArray(payments.status, ['submitting', 'unknown']))).run()
  if (res.changes === 1) {
    setInvoice(db, row.invoiceId, { status: 'paid' })
    logEvent(db, { orgId: row.orgId, kind: 'paid', invoiceId: row.invoiceId, txHash, detail: { to: row.toAddress, amount: row.amountBase, ...(lab ? { lab: true } : {}) } })
  }
}

function markReverted(db: Db, row: Pick<PaymentRow, 'id' | 'orgId' | 'invoiceId' | 'toAddress' | 'amountBase'>, txHash: Hex, lab: boolean) {
  const res = db.update(payments).set({ status: 'reverted', txHash })
    .where(and(eq(payments.id, row.id), inArray(payments.status, ['submitting', 'unknown']))).run()
  if (res.changes === 1) {
    setInvoice(db, row.invoiceId, { status: 'failed' })
    logEvent(db, { orgId: row.orgId, kind: 'chain_rejected', invoiceId: row.invoiceId, txHash, detail: { to: row.toAddress, amount: row.amountBase, code: 'Reverted', ...(lab ? { lab: true } : {}) } })
  }
}

/**
 * An 'unknown' payment may or may not have moved money. Reconcile by its stored tx hash first
 * (receipt), and only without one by scanning for its memo. Never resend from here.
 */
async function reconcile(deps: ServiceDeps, row: PaymentRow, lab: boolean): Promise<PayResult> {
  const txHash = row.txHash && isHex(row.txHash) ? (row.txHash as Hex) : null
  try {
    if (txHash) {
      const st = await deps.ops.getReceipt(txHash)
      if (st === 'success') { markPaid(deps.db, row, txHash, lab); return { status: 'paid', txHash } }
      if (st === 'reverted') { markReverted(deps.db, row, txHash, lab); return { status: 'failed', reason: 'reverted', txHash } }
      return { status: 'failed', reason: 'unreconciled', txHash }
    }
    const found = await deps.ops.findPaymentByMemo(row.orgId, row.memo as Hex, { to: getAddress(row.toAddress), amount: BigInt(row.amountBase) })
    if (found) { markPaid(deps.db, row, found, lab); return { status: 'paid', txHash: found } }
    return { status: 'failed', reason: 'unreconciled' }
  } catch (e) {
    console.error('[payments] reconciliation failed', row.id, e)
    return { status: 'failed', reason: 'unreconciled', ...(txHash ? { txHash } : {}) }
  }
}

const isUniqueViolation = (e: unknown) => /SQLITE_CONSTRAINT/.test(String((e as any)?.code ?? '')) || /UNIQUE constraint failed/.test(String((e as any)?.message ?? ''))

/** Atomically claims the invoice's single payment slot. Returns the payment id, or null if another attempt holds it. */
function claimPayment(db: Db, p: { existing: PaymentRow | undefined; orgId: string; invoiceId: string; to: Address; amount: bigint; memo: Hex }): string | null {
  const fields = { toAddress: p.to, amountBase: p.amount.toString(), memo: p.memo, txHash: null, status: 'submitting', createdAt: nowSeconds() }
  if (p.existing) {
    // only a definitely-not-moved attempt (pre-broadcast rejection, or mined revert) can be retried
    const res = db.update(payments).set(fields)
      .where(and(eq(payments.id, p.existing.id), inArray(payments.status, ['rejected', 'reverted']))).run()
    return res.changes === 1 ? p.existing.id : null
  }
  const id = newId('pay')
  try {
    db.insert(payments).values({ id, orgId: p.orgId, invoiceId: p.invoiceId, ...fields }).run()
    return id
  } catch (e) {
    if (isUniqueViolation(e)) return null
    throw e
  }
}

/**
 * Pays an invoice through the org's scoped agent key. Re-verifies the payee every time (never trusts
 * the agent), then pays at most once per invoice: a payments row is claimed BEFORE sending and a
 * possibly-sent payment is only ever reconciled, never resent.
 */
export async function payInvoice(deps: ServiceDeps, invoiceId: string, opts: { lab?: boolean } = {}): Promise<PayResult> {
  const { db } = deps
  const inv = db.select().from(invoices).where(eq(invoices.id, invoiceId)).get()
  if (!inv) return { status: 'failed', reason: 'not_found' }
  const org = db.select().from(orgs).where(eq(orgs.id, inv.orgId)).get()
  if (!org) return { status: 'failed', reason: 'not_found' }
  const lab = !!opts.lab || inv.lab === 1

  // Idempotency: an existing payment row decides before anything else.
  const existing = db.select().from(payments).where(eq(payments.invoiceId, invoiceId)).get()
  if (existing?.status === 'confirmed') return { status: 'paid', txHash: existing.txHash as Hex }
  if (existing?.status === 'submitting') return { status: 'failed', reason: 'in_flight' }
  if (existing?.status === 'unknown') return reconcile(deps, existing, lab)
  // 'rejected' / 'reverted': no money moved; fall through to a fresh, fully re-verified attempt.

  // A human rejection of this invoice's approval is final.
  const rejected = db.select().from(approvals).where(and(eq(approvals.invoiceId, invoiceId), eq(approvals.status, 'rejected'))).get()
  if (rejected) return { status: 'blocked', reason: 'rejected_by_approver' }

  if (!inv.address || !inv.amountBase || !inv.payeeName) return { status: 'failed', reason: 'incomplete_invoice' }
  let amount: bigint
  try { amount = BigInt(inv.amountBase) } catch { return { status: 'failed', reason: 'incomplete_invoice' } }
  if (amount <= 0n) return { status: 'failed', reason: 'incomplete_invoice' }
  if (!org.authorized) return { status: 'failed', reason: 'org_not_authorized' }

  let v: VerifyOutput
  try {
    v = await verifyPayee(deps, { address: inv.address as Address, payeeName: inv.payeeName, senderDomain: inv.senderDomain ?? undefined, orgId: org.id })
  } catch (e) {
    console.error('[payments] verification failed; not paying', invoiceId, e)
    setInvoice(db, invoiceId, { status: 'failed' })
    return { status: 'failed', reason: 'verify_error' }
  }
  setInvoice(db, invoiceId, { verdictJson: JSON.stringify(v), action: v.action })
  const detail = { to: v.address, amount: amount.toString(), verdict: v.verdict, ...(lab ? { lab: true } : {}) }

  if (v.keyUnrestricted) {
    setInvoice(db, invoiceId, { status: 'failed' })
    logEvent(db, { orgId: org.id, kind: 'key_unrestricted', invoiceId, detail })
    return { status: 'failed', reason: 'key_unrestricted' }
  }
  if (v.action === 'BLOCK') {
    setInvoice(db, invoiceId, { status: 'blocked' })
    logEvent(db, { orgId: org.id, kind: 'blocked', invoiceId, detail: { ...detail, reasons: v.reasons } })
    return { status: 'blocked', reason: v.verdict.toLowerCase() }
  }
  if (v.action === 'ASK') {
    const ap = await requestApproval(deps, { orgId: org.id, invoiceId, wallet: v.address, label: v.payee?.legalName ?? inv.payeeName, verdict: v })
    setInvoice(db, invoiceId, { status: 'awaiting_approval' })
    logEvent(db, { orgId: org.id, kind: 'asked', invoiceId, detail: { ...detail, approvalId: ap.id, reasons: v.reasons } })
    return { status: 'asked', reason: 'needs_approval', approvalId: ap.id }
  }

  // PAY
  const to = v.address
  const memo = memoFromInvoice(inv.invoiceNo?.trim() || inv.id)
  let pre: Awaited<ReturnType<ChainOps['preflight']>>
  try {
    pre = await deps.ops.preflight({ orgId: org.id, to, amount, memo })
  } catch (e) {
    pre = { ok: false, code: 'Other', message: (e as Error)?.message ?? String(e) }
  }
  if (!pre.ok) {
    if (pre.code === 'SpendingLimitExceeded') {
      // An allowlist approval cannot fix a spending limit, so no approval row is created: a human
      // must raise the limit or wait for the period to roll over.
      setInvoice(db, invoiceId, { action: 'ASK', status: 'awaiting_approval' })
      logEvent(db, { orgId: org.id, kind: 'asked', invoiceId, detail: { ...detail, reason: 'over_limit' } })
      return { status: 'asked', reason: 'over_limit' }
    }
    setInvoice(db, invoiceId, { status: 'failed' })
    logEvent(db, { orgId: org.id, kind: 'preflight_failed', invoiceId, detail: { ...detail, code: pre.code, message: pre.message } })
    return { status: 'failed', reason: 'preflight_failed' }
  }

  const paymentId = claimPayment(db, { existing, orgId: org.id, invoiceId, to, amount, memo })
  if (!paymentId) return { status: 'failed', reason: 'in_flight' }
  const row = { id: paymentId, orgId: org.id, invoiceId, toAddress: to, amountBase: amount.toString() }

  let sent: Awaited<ReturnType<ChainOps['send']>>
  try {
    sent = await deps.ops.send({ orgId: org.id, to, amount, memo })
  } catch (e) {
    if (e instanceof PaymentNotSent) {
      db.update(payments).set({ status: 'rejected' }).where(eq(payments.id, paymentId)).run()
      setInvoice(db, invoiceId, { status: 'failed' })
      logEvent(db, { orgId: org.id, kind: 'chain_rejected', invoiceId, detail: { ...detail, code: e.code, message: e.message, broadcast: false } })
      return { status: 'failed', reason: 'not_sent' }
    }
    // Possibly broadcast: record what we know and reconcile later. Never resend blindly.
    const maybe = (e as { txHash?: unknown })?.txHash
    const txHash = typeof maybe === 'string' && isHex(maybe) ? maybe : null
    db.update(payments).set({ status: 'unknown', txHash }).where(eq(payments.id, paymentId)).run()
    setInvoice(db, invoiceId, { status: 'processing' })
    console.error('[payments] outcome unknown', paymentId, txHash, e)
    return { status: 'failed', reason: 'rpc_error', ...(txHash ? { txHash } : {}) }
  }
  if (sent.status !== 'success') {
    markReverted(db, row, sent.txHash, lab)
    return { status: 'failed', reason: 'reverted', txHash: sent.txHash }
  }
  markPaid(db, row, sent.txHash, lab)
  return { status: 'paid', txHash: sent.txHash }
}

// Error classes are matched by name as well as instanceof: core builds its viem clients from its own
// viem instance, so `instanceof` against the server's copy of a viem class can be false.
const errorNamed = (e: unknown, name: string) => {
  let cur: any = e
  for (let depth = 0; cur && depth < 6; depth++, cur = cur.cause) if (cur?.name === name) return true
  return false
}

export const isReceiptNotFound = (e: unknown) => e instanceof TransactionReceiptNotFoundError || errorNamed(e, 'TransactionReceiptNotFoundError')

/**
 * Maps a payWithKey failure for payInvoice. Anything that carries a tx hash may have been broadcast and
 * is rethrown unchanged (payInvoice records it as 'unknown'); everything else happened before broadcast.
 */
export function mapSendError(e: unknown): Error {
  const txHash = (e as { txHash?: unknown } | null)?.txHash
  if (e instanceof PaymentOutcomeUnknown || (e as Error | null)?.name === 'PaymentOutcomeUnknown' || (typeof txHash === 'string' && isHex(txHash))) {
    return e instanceof Error ? e : Object.assign(new Error(String(e)), { txHash })
  }
  if (e instanceof PaymentRejected || (e as Error | null)?.name === 'PaymentRejected') {
    return new PaymentNotSent(String((e as PaymentRejected).code ?? 'Other'), (e as Error).message)
  }
  // payWithKey only throws other errors (client/chain assertions) before broadcasting; so does our key loading
  return new PaymentNotSent('Other', (e as Error | null)?.message ?? String(e))
}

/** Gas used for lab "guard off" sends so estimation (which would refuse) is skipped. */
const FORCE_GAS = 1_000_000n
/** How far back findPaymentByMemo scans for the org's TransferWithMemo logs. */
const MEMO_LOOKBACK = 20_000n

export function productionChainOps(deps: AppDeps): ChainOps {
  const { db, chain, config } = deps
  const pub = chain.pub
  const token = chain.token

  const loadOrg = (orgId: string) => {
    const o = db.select().from(orgs).where(eq(orgs.id, orgId)).get()
    if (!o) throw new Error(`Unknown org ${orgId}`)
    return o
  }
  const accountFor = (orgId: string) => {
    const o = loadOrg(orgId)
    return agentAccount(decryptSecret(o.agentKeyEnc, config.serverSecret) as Hex, getAddress(o.rootAddress))
  }

  return {
    resolveRecipient: (to) => resolveRecipient(pub, to),
    readAllowlist: (account, keyId) => readAllowlist(pub, { account, keyId, token }),
    readPayee: (wallet) => readPayee(pub as any, config.registry, wallet),

    async preflight(p) {
      const r = await preflightPay(pub, { account: accountFor(p.orgId), token, to: p.to, amount: p.amount, memo: p.memo })
      return r.ok ? { ok: true } : { ok: false, code: r.code, message: r.message }
    },

    async send(p) {
      try {
        const r = await payWithKey({ network: chain.network, account: accountFor(p.orgId), token, to: p.to, amount: p.amount, memo: p.memo, ...(p.force ? { gas: FORCE_GAS } : {}) })
        return { txHash: r.txHash, status: r.status }
      } catch (e) {
        throw mapSendError(e)
      }
    },

    async waitReceipt(hash) {
      const r = await pub.waitForTransactionReceipt({ hash, timeout: 90_000 })
      return { status: r.status === 'success' ? 'success' : 'reverted' }
    },

    async getReceipt(hash) {
      try {
        const r = await pub.getTransactionReceipt({ hash })
        return r.status === 'success' ? 'success' : 'reverted'
      } catch (e) {
        if (isReceiptNotFound(e)) return null
        throw e
      }
    },

    async findPaymentByMemo(orgId, memo, match) {
      const org = loadOrg(orgId)
      const head = await pub.getBlockNumber()
      const logs = await pub.getContractEvents({
        address: token, abi: Abis.tip20, eventName: 'TransferWithMemo',
        args: { from: getAddress(org.rootAddress), memo },
        fromBlock: head > MEMO_LOOKBACK ? head - MEMO_LOOKBACK : 0n, toBlock: head,
      })
      const hit = logs.find((l: any) => !match || l.args?.amount === match.amount)
      return (hit?.transactionHash as Hex | undefined) ?? null
    },

    async readKey(account, keyId) {
      const k = (await readKey(pub, account, keyId)) as { expiry: bigint | number; enforceLimits: boolean; isRevoked: boolean }
      return { expiry: BigInt(k.expiry), enforceLimits: k.enforceLimits, isRevoked: k.isRevoked }
    },

    async remainingLimit(account, keyId) {
      return (await pub.readContract({ address: KEYCHAIN, abi: Abis.accountKeychain, functionName: 'getRemainingLimit', args: [account, keyId, token] })) as bigint
    },

    async sendDemoRoot(call) {
      if (!config.demoRootKey) throw new Error('DEMO_ROOT_PRIVATE_KEY is not configured')
      const n = getNetwork(chain.network)
      const account = Account.fromSecp256k1(config.demoRootKey)
      const client = createClient({ account, chain: n.chain, transport: http(n.rpc) }).extend(publicActions).extend(walletActions)
      const r: any = await client.sendTransactionSync({ ...call, throwOnReceiptRevert: true } as any)
      return r.transactionHash as Hex
    },
  }
}
