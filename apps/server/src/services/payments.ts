import {
  createClient, getAddress, http, isHex, publicActions, TransactionReceiptNotFoundError, walletActions,
  type Address, type Hex,
} from 'viem'
import { Abis, Account } from 'viem/tempo'
import { and, eq, inArray, ne, notInArray } from 'drizzle-orm'
import {
  agentAccount, forceSendWithKey, getNetwork, isVirtualAddress, KEYCHAIN, memoFromInvoice, payWithKey, PaymentOutcomeUnknown, PaymentRejected,
  preflightPay, readAllowlist, readKey, readPayee, resolveRecipient, type OnchainPayee,
} from '@bound/core'
import type { AppDeps } from '../app'
import { decryptSecret, newId } from '../crypto'
import type { Db } from '../db/client'
import { approvals, invoices, orgs, payments } from '../db/schema'
import { requestApproval } from './approvals'
import { logEvent, nowSeconds } from './events'
import { withOrgLock } from './mutex'
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
   * `force` is for the attack lab's "guard off" only: broadcast with no simulation (core forceSendWithKey),
   * so Tempo, not Bound, decides; a keychain violation is mined and reverts.
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

/** Only a UNIQUE (or primary-key, which SQLite also reports as UNIQUE) violation means "another attempt holds the slot". */
export const isUniqueViolation = (e: unknown) => String((e as { message?: unknown } | null)?.message ?? '').includes('UNIQUE')

const same = (x: string, y: string) => x.toLowerCase() === y.toLowerCase()

/**
 * Another invoice of this org already paying (or paid, or possibly paid) the same effective payee with
 * the same memo is a duplicate invoice. Only definitely-not-moved payments (rejected/reverted) are ignored.
 * Attack-lab payments count too: a guarded lab run pays real, approved payees through payInvoice.
 */
async function findDuplicate(deps: ServiceDeps, p: { orgId: string; invoiceId: string; memo: Hex; to: Address; effective: Address }): Promise<string | null> {
  const rows = deps.db.select().from(payments).where(and(
    eq(payments.orgId, p.orgId), eq(payments.memo, p.memo), ne(payments.invoiceId, p.invoiceId),
    notInArray(payments.status, ['rejected', 'reverted']),
  )).all()
  for (const r of rows) {
    const eff = same(r.toAddress, p.to) ? p.effective
      : isVirtualAddress(r.toAddress) ? getAddress((await deps.ops.resolveRecipient(getAddress(r.toAddress))).effective)
      : getAddress(r.toAddress)
    if (eff === p.effective) return r.invoiceId
  }
  return null
}

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

  // PAY: duplicate check → preflight → claim → send run under the org lock, so two invoices of one org
  // never race the agent key's nonce, the spending limit, or each other's duplicate check.
  // (withOrgLock is not re-entrant: payInvoice must never be called from inside withOrgLock.)
  const memo = memoFromInvoice(inv.invoiceNo?.trim() || inv.id)
  return withOrgLock(org.id, () => payLocked(deps, { orgId: org.id, invoiceId, to: v.address, effective: v.effectiveAddress, amount, memo, lab, detail }))
}

async function payLocked(
  deps: ServiceDeps,
  p: { orgId: string; invoiceId: string; to: Address; effective: Address; amount: bigint; memo: Hex; lab: boolean; detail: Record<string, unknown> },
): Promise<PayResult> {
  const { db } = deps
  const { orgId, invoiceId, to, amount, memo, lab, detail } = p

  // Re-read under the lock: another attempt for this invoice may have finished while we verified.
  const current = db.select().from(payments).where(eq(payments.invoiceId, invoiceId)).get()
  if (current?.status === 'confirmed') return { status: 'paid', txHash: current.txHash as Hex }
  if (current && current.status !== 'rejected' && current.status !== 'reverted') return { status: 'failed', reason: 'in_flight' }

  let duplicateOf: string | null
  try {
    duplicateOf = await findDuplicate(deps, { orgId, invoiceId, memo, to, effective: p.effective })
  } catch (e) {
    console.error('[payments] duplicate check failed; not paying', invoiceId, e)
    return { status: 'failed', reason: 'duplicate_check_failed' }
  }
  if (duplicateOf) {
    setInvoice(db, invoiceId, { status: 'blocked' })
    logEvent(db, { orgId, kind: 'blocked', invoiceId, detail: { ...detail, reason: 'duplicate_invoice', duplicateOf } })
    return { status: 'blocked', reason: 'duplicate_invoice' }
  }

  let pre: Awaited<ReturnType<ChainOps['preflight']>>
  try {
    pre = await deps.ops.preflight({ orgId, to, amount, memo })
  } catch (e) {
    console.error('[payments] preflight errored', invoiceId, e)
    pre = { ok: false, code: 'Other', message: '' }
  }
  if (!pre.ok) {
    if (pre.code === 'SpendingLimitExceeded') {
      // An allowlist approval cannot fix a spending limit, so no approval row is created: a human
      // must raise the limit or wait for the period to roll over.
      setInvoice(db, invoiceId, { action: 'ASK', status: 'over_limit' })
      logEvent(db, { orgId, kind: 'over_limit', invoiceId, detail: { ...detail, reason: 'over_limit' } })
      return { status: 'asked', reason: 'over_limit' }
    }
    setInvoice(db, invoiceId, { status: 'failed' })
    logEvent(db, { orgId, kind: 'preflight_failed', invoiceId, detail: { ...detail, code: pre.code } })
    return { status: 'failed', reason: 'preflight_failed' }
  }

  const paymentId = claimPayment(db, { existing: current, orgId, invoiceId, to, amount, memo })
  if (!paymentId) return { status: 'failed', reason: 'in_flight' }
  const row = { id: paymentId, orgId, invoiceId, toAddress: to, amountBase: amount.toString() }
  const markUnknown = (txHash: Hex | null) => {
    db.update(payments).set({ status: 'unknown', txHash }).where(eq(payments.id, paymentId)).run()
    setInvoice(db, invoiceId, { status: 'processing' })
    return { status: 'failed' as const, reason: 'rpc_error', ...(txHash ? { txHash } : {}) }
  }

  let sent: Awaited<ReturnType<ChainOps['send']>>
  try {
    sent = await deps.ops.send({ orgId, to, amount, memo })
  } catch (e) {
    if (e instanceof PaymentNotSent) {
      console.error('[payments] not sent', paymentId, e.code, e)
      db.update(payments).set({ status: 'rejected' }).where(eq(payments.id, paymentId)).run()
      setInvoice(db, invoiceId, { status: 'failed' })
      logEvent(db, { orgId, kind: 'chain_rejected', invoiceId, detail: { ...detail, code: e.code, broadcast: false } })
      return { status: 'failed', reason: 'not_sent' }
    }
    // Possibly broadcast: record what we know and reconcile later. Never resend blindly.
    console.error('[payments] outcome unknown', paymentId, e)
    const maybe = (e as { txHash?: unknown } | null)?.txHash
    return markUnknown(typeof maybe === 'string' && isHex(maybe) ? maybe : null)
  }
  // Explicit mapping: only 'success' is paid and only 'reverted' is a revert; anything else is unknown.
  if (sent?.status === 'success') {
    markPaid(db, row, sent.txHash, lab)
    return { status: 'paid', txHash: sent.txHash }
  }
  if (sent?.status === 'reverted') {
    markReverted(db, row, sent.txHash, lab)
    return { status: 'failed', reason: 'reverted', txHash: sent.txHash }
  }
  console.error('[payments] unrecognised send result; treating as unknown', paymentId, sent)
  const hash = sent?.txHash
  return markUnknown(typeof hash === 'string' && isHex(hash) ? hash : null)
}

// Error classes are matched by name as well as instanceof: core builds its viem clients from its own
// viem instance, so `instanceof` against the server's copy of a viem class can be false.
const errorNamed = (e: unknown, name: string) => {
  let cur: any = e
  for (let depth = 0; cur && depth < 6; depth++, cur = cur.cause) if (cur?.name === name) return true
  return false
}

export const isReceiptNotFound = (e: unknown) => e instanceof TransactionReceiptNotFoundError || errorNamed(e, 'TransactionReceiptNotFoundError')

/** core's own pre-broadcast guard in payWithKey (assertTempoClient). */
const PRE_BROADCAST_GUARD = /^Refusing to run: client is not a Tempo client/

/**
 * Maps a payWithKey failure for payInvoice. Only an explicit pre-broadcast rejection (PaymentRejected,
 * by instanceof or name, or core's own client guard) means "not sent". Everything else, including
 * PaymentOutcomeUnknown (which carries the tx hash) and any unrecognised error, MAY have been
 * broadcast and is passed through unchanged, so payInvoice records it as 'unknown' and never resends.
 */
export function mapSendError(e: unknown): Error {
  if (e instanceof PaymentRejected || (e as Error | null)?.name === 'PaymentRejected') {
    return new PaymentNotSent(String((e as PaymentRejected).code ?? 'Other'), (e as Error).message)
  }
  if (e instanceof Error && PRE_BROADCAST_GUARD.test(e.message)) return new PaymentNotSent('Other', e.message)
  return e instanceof Error ? e : new Error(String(e))
}

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
  /** Explicit receipt mapping: 'success' / 'reverted' only; anything else (incl. not found) is null = unknown. */
  const receiptStatus = async (hash: Hex): Promise<'success' | 'reverted' | null> => {
    try {
      const r = await pub.getTransactionReceipt({ hash })
      return r?.status === 'success' ? 'success' : r?.status === 'reverted' ? 'reverted' : null
    } catch (e) {
      if (isReceiptNotFound(e)) return null
      throw e
    }
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
      let account: ReturnType<typeof accountFor>
      try {
        account = accountFor(p.orgId) // our own pre-broadcast step
      } catch (e) {
        console.error('[payments] agent key unavailable', p.orgId, e)
        throw new PaymentNotSent('Other', 'agent key unavailable')
      }
      let r: Awaited<ReturnType<typeof payWithKey>>
      try {
        const args = { network: chain.network, account, token, to: p.to, amount: p.amount, memo: p.memo }
        // force (attack lab "guard off" only): no simulation at all, so a keychain violation is mined and reverts onchain
        // mainnet only when the operator explicitly enabled the lab there (the core refuses 4217 otherwise)
        r = p.force ? await forceSendWithKey(args, { allowMainnet: chain.network === 'mainnet' && config.labEnabled === true }) : await payWithKey(args)
      } catch (e) {
        throw mapSendError(e)
      }
      if (r.status === 'success') return { txHash: r.txHash, status: 'success' }
      // core reports every non-success receipt as 'reverted'; only call it a revert when the receipt says so
      let st: 'success' | 'reverted' | null = null
      try { st = await receiptStatus(r.txHash) } catch { st = null }
      if (st) return { txHash: r.txHash, status: st }
      throw new PaymentOutcomeUnknown(r.txHash, new Error('receipt status could not be confirmed'))
    },

    async waitReceipt(hash) {
      const r = await pub.waitForTransactionReceipt({ hash, timeout: 90_000 })
      // consumers only proceed on 'success'; anything else fails closed
      return { status: r.status === 'success' ? 'success' : 'reverted' }
    },

    getReceipt: receiptStatus,

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
