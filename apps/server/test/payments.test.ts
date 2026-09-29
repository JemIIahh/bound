import { describe, expect, test, vi } from 'vitest'
import { AllowlistError, memoFromInvoice, PaymentOutcomeUnknown, PaymentRejected } from '@bound/core'
import { createDb, migrate } from '../src/db/client'
import { approvals, events, invoices, orgs, payees, payments, pins } from '../src/db/schema'
import { isUniqueViolation, mapSendError, payInvoice, PaymentNotSent, productionChainOps } from '../src/services/payments'
import { verifyPayee } from '../src/services/verify-service'
import { and, eq } from 'drizzle-orm'

const acme = '0xCcB7f43C7D6DBbC4e545d8C01761098da5332ED2'
const root = '0x3333333333333333333333333333333333333333'
const agent = '0x4444444444444444444444444444444444444444'

function setup(allowlist: string[] = [root, acme]) {
  const db = createDb(':memory:'); migrate(db)
  db.insert(orgs).values({ id: 'org1', name: 'Buyer', rootAddress: root, agentKeyAddress: agent, agentKeyEnc: 'x', tokenHash: 'h', limitBase: '1000000000', periodSeconds: 604800, authorized: 1, createdAt: 1 }).run()
  db.insert(payees).values({ wallet: acme, legalName: 'Acme Ltd', domain: 'acme.com', lei: '', masterId: '0x00000000', level: 1, activeFrom: 1, evidenceHash: '0x00', updatedBlock: 1 }).run()
  db.insert(invoices).values({ id: 'inv1', orgId: 'org1', raw: 'x', payeeName: 'Acme Ltd', address: acme, amountBase: '100000000', currency: 'USDC', invoiceNo: 'INV-1042', createdAt: 1 }).run()
  const ops = {
    resolveRecipient: vi.fn(async (to: any) => ({ effective: to, isVirtual: false, masterId: null, registered: true })),
    readAllowlist: vi.fn(async () => allowlist as any),
    preflight: vi.fn(async () => ({ ok: true as const })),
    send: vi.fn(async () => ({ txHash: '0xaaa' as `0x${string}`, status: 'success' as const })),
    waitReceipt: vi.fn(async () => ({ status: 'success' as const })),
    getReceipt: vi.fn(async (): Promise<'success' | 'reverted' | null> => null),
    findPaymentByMemo: vi.fn(async (): Promise<`0x${string}` | null> => null),
    readPayee: vi.fn(async (): Promise<any> => null),
  }
  const deps = { db, chain: { network: 'testnet', token: '0x20c0000000000000000000000000000000000000' } as any, config: {} as any, ops }
  return { db, deps, ops }
}

const paymentRow = (db: ReturnType<typeof setup>['db']) => db.select().from(payments).where(eq(payments.invoiceId, 'inv1')).get()
const invoiceRow = (db: ReturnType<typeof setup>['db']) => db.select().from(invoices).where(eq(invoices.id, 'inv1')).get()

describe('payInvoice', () => {
  test('pays an allowlisted MATCH once', async () => {
    const { deps, ops, db } = setup()
    const r = await payInvoice(deps as any, 'inv1')
    expect(r.status).toBe('paid')
    expect(ops.send).toHaveBeenCalledOnce()
    expect(db.select().from(payments).where(eq(payments.invoiceId, 'inv1')).get()?.status).toBe('confirmed')
  })
  test('second call for the same invoice does not send again', async () => {
    const { deps, ops } = setup()
    await payInvoice(deps as any, 'inv1')
    const r2 = await payInvoice(deps as any, 'inv1')
    expect(r2.status).toBe('paid')
    expect(ops.send).toHaveBeenCalledOnce()
  })
  test('two concurrent calls send once', async () => {
    const { deps, ops } = setup()
    await Promise.all([payInvoice(deps as any, 'inv1'), payInvoice(deps as any, 'inv1')])
    expect(ops.send).toHaveBeenCalledOnce()
  })
  test('RPC error after send (tx hash known) marks unknown with the hash, reconciles by receipt, never resends', async () => {
    const { deps, ops, db } = setup()
    ops.send.mockRejectedValueOnce(new PaymentOutcomeUnknown('0xbbb', new Error('502 Bad Gateway')))
    const r = await payInvoice(deps as any, 'inv1')
    expect(r.status).toBe('failed')
    expect(paymentRow(db)).toMatchObject({ status: 'unknown', txHash: '0xbbb' })
    // not visible yet: stays unknown, nothing resent
    const r2 = await payInvoice(deps as any, 'inv1')
    expect(r2).toMatchObject({ status: 'failed', reason: 'unreconciled' })
    expect(paymentRow(db)?.status).toBe('unknown')
    ops.getReceipt.mockResolvedValueOnce('success')
    const r3 = await payInvoice(deps as any, 'inv1')
    expect(r3).toMatchObject({ status: 'paid', txHash: '0xbbb' })
    expect(ops.getReceipt).toHaveBeenCalledWith('0xbbb')
    expect(ops.findPaymentByMemo).not.toHaveBeenCalled()
    expect(ops.send).toHaveBeenCalledOnce()
    expect(paymentRow(db)?.status).toBe('confirmed')
    expect(invoiceRow(db)?.status).toBe('paid')
    expect(db.select().from(events).where(eq(events.kind, 'paid')).all()).toHaveLength(1)
  })
  test('RPC error after send (no tx hash) marks unknown and reconciles by memo, never resends', async () => {
    const { deps, ops, db } = setup()
    ops.send.mockRejectedValueOnce(new Error('502 Bad Gateway'))
    const r = await payInvoice(deps as any, 'inv1')
    expect(r.status).toBe('failed')
    expect(db.select().from(payments).where(eq(payments.invoiceId, 'inv1')).get()?.status).toBe('unknown')
    ops.findPaymentByMemo.mockResolvedValueOnce('0xbbb')
    const r2 = await payInvoice(deps as any, 'inv1')
    expect(r2).toMatchObject({ status: 'paid', txHash: '0xbbb' })
    expect(ops.send).toHaveBeenCalledOnce()
    expect(ops.getReceipt).not.toHaveBeenCalled()
  })
  test('an unknown payment whose receipt shows a revert is marked reverted; a later attempt re-verifies and sends', async () => {
    const { deps, ops, db } = setup()
    ops.send.mockRejectedValueOnce(new PaymentOutcomeUnknown('0xccc', new Error('timeout')))
    await payInvoice(deps as any, 'inv1')
    ops.getReceipt.mockResolvedValueOnce('reverted')
    const r2 = await payInvoice(deps as any, 'inv1')
    expect(r2).toMatchObject({ status: 'failed', reason: 'reverted', txHash: '0xccc' })
    expect(paymentRow(db)?.status).toBe('reverted')
    const r3 = await payInvoice(deps as any, 'inv1')
    expect(r3).toMatchObject({ status: 'paid', txHash: '0xaaa' })
    expect(ops.send).toHaveBeenCalledTimes(2)
    expect(ops.resolveRecipient).toHaveBeenCalledTimes(2)
  })
  test('a receipt lookup that errors keeps the payment unknown', async () => {
    const { deps, ops, db } = setup()
    ops.send.mockRejectedValueOnce(new PaymentOutcomeUnknown('0xddd', new Error('timeout')))
    await payInvoice(deps as any, 'inv1')
    ops.getReceipt.mockRejectedValueOnce(new Error('503'))
    expect(await payInvoice(deps as any, 'inv1')).toMatchObject({ status: 'failed', reason: 'unreconciled' })
    expect(paymentRow(db)?.status).toBe('unknown')
    expect(ops.send).toHaveBeenCalledOnce()
  })
  test('a pre-broadcast rejection (nothing sent) frees the invoice for a later attempt', async () => {
    const { deps, ops, db } = setup()
    ops.send.mockRejectedValueOnce(new PaymentNotSent('Other', 'nonce too low'))
    const r = await payInvoice(deps as any, 'inv1')
    expect(r).toMatchObject({ status: 'failed', reason: 'not_sent' })
    expect(paymentRow(db)?.status).toBe('rejected')
    const r2 = await payInvoice(deps as any, 'inv1')
    expect(r2.status).toBe('paid')
    expect(ops.send).toHaveBeenCalledTimes(2)
    expect(paymentRow(db)?.status).toBe('confirmed')
  })
  test('a mined revert is recorded and not reported as paid', async () => {
    const { deps, ops, db } = setup()
    ops.send.mockResolvedValueOnce({ txHash: '0xeee', status: 'reverted' } as any)
    const r = await payInvoice(deps as any, 'inv1')
    expect(r).toMatchObject({ status: 'failed', reason: 'reverted', txHash: '0xeee' })
    expect(paymentRow(db)).toMatchObject({ status: 'reverted', txHash: '0xeee' })
    expect(invoiceRow(db)?.status).toBe('failed')
  })
  test('not allowlisted → asked, nothing sent', async () => {
    const { deps, ops } = setup([root])
    const r = await payInvoice(deps as any, 'inv1')
    expect(r.status).toBe('asked')
    expect(ops.send).not.toHaveBeenCalled()
  })
  test('over the spending limit → asked with over_limit; invoice over_limit, no approval row', async () => {
    const { deps, ops, db } = setup()
    ops.preflight.mockResolvedValueOnce({ ok: false, code: 'SpendingLimitExceeded', message: 'limit' } as any)
    const r = await payInvoice(deps as any, 'inv1')
    expect(r).toMatchObject({ status: 'asked', reason: 'over_limit' })
    expect(invoiceRow(db)?.status).toBe('over_limit')
    expect(db.select().from(approvals).all()).toHaveLength(0)
    const ev = db.select().from(events).where(eq(events.invoiceId, 'inv1')).all().filter((e) => e.kind !== 'check')
    expect(ev.map((e) => JSON.parse(e.detailJson).reason)).toEqual(['over_limit'])
    expect(ops.send).not.toHaveBeenCalled()
  })
  test('a send result that is neither success nor reverted is unknown and never resent', async () => {
    const { deps, ops, db } = setup()
    ops.send.mockResolvedValueOnce({ txHash: '0xfff', status: undefined } as any)
    const r = await payInvoice(deps as any, 'inv1')
    expect(r).toMatchObject({ status: 'failed', reason: 'rpc_error', txHash: '0xfff' })
    expect(paymentRow(db)).toMatchObject({ status: 'unknown', txHash: '0xfff' })
    expect(await payInvoice(deps as any, 'inv1')).toMatchObject({ status: 'failed', reason: 'unreconciled' })
    expect(ops.send).toHaveBeenCalledOnce()
  })
  test('failure events store decoded codes, never raw error messages', async () => {
    const { deps, ops, db } = setup()
    ops.preflight.mockResolvedValueOnce({ ok: false, code: 'CallNotAllowed', message: 'https://rpc.secret/key123 reverted' } as any)
    await payInvoice(deps as any, 'inv1')
    ops.send.mockRejectedValueOnce(new PaymentNotSent('Other', 'https://rpc.secret/key123 nonce too low'))
    await payInvoice(deps as any, 'inv1')
    const all = db.select().from(events).all()
    expect(all.some((e) => e.kind === 'preflight_failed' && JSON.parse(e.detailJson).code === 'CallNotAllowed')).toBe(true)
    expect(all.some((e) => e.kind === 'chain_rejected' && JSON.parse(e.detailJson).code === 'Other')).toBe(true)
    expect(JSON.stringify(all)).not.toContain('rpc.secret')
  })
  test('claim → send is serialized per org (no nonce races between invoices)', async () => {
    const { deps, ops, db } = setup()
    db.insert(invoices).values({ id: 'inv2', orgId: 'org1', raw: 'x', payeeName: 'Acme Ltd', address: acme, amountBase: '5000000', currency: 'USDC', invoiceNo: 'INV-1043', createdAt: 1 }).run()
    let active = 0
    let maxActive = 0
    ops.send.mockImplementation(async () => {
      active++; maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, 25))
      active--
      return { txHash: ('0x' + (maxActive + active + 10).toString(16)) as `0x${string}`, status: 'success' as const }
    })
    const [r1, r2] = await Promise.all([payInvoice(deps as any, 'inv1'), payInvoice(deps as any, 'inv2')])
    expect([r1.status, r2.status]).toEqual(['paid', 'paid'])
    expect(ops.send).toHaveBeenCalledTimes(2)
    expect(maxActive).toBe(1)
  })
  test('lookalike address → blocked even if a pin exists for it', async () => {
    const { deps, db } = setup()
    const look = '0xccb7' + '1'.repeat(32) + '2ed2'
    db.update(invoices).set({ address: look }).where(eq(invoices.id, 'inv1')).run()
    db.insert(pins).values({ orgId: 'org1', wallet: look, label: 'x', approvedAt: 1, active: 1 }).run()
    const r = await payInvoice(deps as any, 'inv1')
    expect(r.status).toBe('blocked')
  })
  test('an unrestricted agent key is a hard misconfiguration: never allowlisted, nothing sent', async () => {
    const { deps, ops, db } = setup()
    ops.readAllowlist.mockRejectedValue(new AllowlistError('unrestricted: key has no call scopes (any call allowed).'))
    db.insert(pins).values({ orgId: 'org1', wallet: acme, label: 'Acme Ltd', approvedAt: 1, active: 1 }).run()
    const v = await verifyPayee(deps as any, { address: acme as any, payeeName: 'Acme Ltd', orgId: 'org1' })
    expect(v.allowlisted).toBe(false)
    expect(v.action).not.toBe('PAY')
    const r = await payInvoice(deps as any, 'inv1')
    expect(r).toEqual({ status: 'failed', reason: 'key_unrestricted' })
    expect(ops.preflight).not.toHaveBeenCalled()
    expect(ops.send).not.toHaveBeenCalled()
    expect(paymentRow(db)).toBeUndefined()
  })
  test('a verification error is never treated as PAY', async () => {
    const { deps, ops, db } = setup([root, acme, '0x7777777777777777777777777777777777777777'])
    db.update(invoices).set({ address: '0x7777777777777777777777777777777777777777' }).where(eq(invoices.id, 'inv1')).run()
    // a record that does not belong to the destination makes evaluate() throw
    ops.readPayee.mockResolvedValueOnce({ wallet: acme, legalName: 'Acme Ltd', domain: 'acme.com', lei: '', masterId: '0x00000000', level: 1, verifiedAt: 1, activeFrom: 1, supersededAt: 0, revokedAt: 0, successor: null, evidenceHash: '0x00' })
    const r = await payInvoice(deps as any, 'inv1')
    expect(r).toMatchObject({ status: 'failed', reason: 'verify_error' })
    expect(ops.send).not.toHaveBeenCalled()
  })
  test('incomplete invoice is not paid', async () => {
    const { deps, ops, db } = setup()
    db.update(invoices).set({ amountBase: null }).where(eq(invoices.id, 'inv1')).run()
    expect(await payInvoice(deps as any, 'inv1')).toEqual({ status: 'failed', reason: 'incomplete_invoice' })
    expect(ops.send).not.toHaveBeenCalled()
  })
  test('the payment row is written before the send and reconciled against its own stored fields', async () => {
    const { deps, ops, db } = setup()
    let seen: any
    ops.send.mockImplementationOnce(async () => { seen = paymentRow(db); throw new Error('socket hang up') })
    await payInvoice(deps as any, 'inv1')
    expect(seen).toMatchObject({ status: 'submitting', toAddress: acme, amountBase: '100000000' })
    // the agent rewrites the invoice afterwards: reconciliation still uses the stored memo/amount
    db.update(invoices).set({ amountBase: '999', invoiceNo: 'OTHER' }).where(eq(invoices.id, 'inv1')).run()
    await payInvoice(deps as any, 'inv1')
    expect(ops.findPaymentByMemo).toHaveBeenCalledWith('org1', seen.memo, { to: acme, amount: 100000000n })
    expect(ops.send).toHaveBeenCalledOnce()
  })
})

describe('stuck submitting payments', () => {
  const now = () => Math.floor(Date.now() / 1000)
  const MEMO = memoFromInvoice('INV-1042')
  const insertSubmitting = (db: ReturnType<typeof setup>['db'], age: number) =>
    db.insert(payments).values({ id: 'pay1', orgId: 'org1', invoiceId: 'inv1', toAddress: acme, amountBase: '100000000', memo: MEMO, txHash: null, status: 'submitting', createdAt: now() - age }).run()

  test('a submitting payment younger than 120 s is still in flight: nothing reconciled, nothing sent', async () => {
    const { deps, ops, db } = setup()
    insertSubmitting(db, 10)
    expect(await payInvoice(deps as any, 'inv1')).toEqual({ status: 'failed', reason: 'in_flight' })
    expect(ops.findPaymentByMemo).not.toHaveBeenCalled()
    expect(ops.send).not.toHaveBeenCalled()
  })
  test('a submitting payment older than 120 s is treated as unknown and reconciled (found → paid), never resent', async () => {
    const { deps, ops, db } = setup()
    insertSubmitting(db, 121)
    ops.findPaymentByMemo.mockResolvedValueOnce('0xbbb')
    expect(await payInvoice(deps as any, 'inv1')).toEqual({ status: 'paid', txHash: '0xbbb' })
    expect(ops.findPaymentByMemo).toHaveBeenCalledWith('org1', MEMO, { to: acme, amount: 100000000n })
    expect(ops.send).not.toHaveBeenCalled()
    expect(paymentRow(db)).toMatchObject({ status: 'confirmed', txHash: '0xbbb' })
    expect(invoiceRow(db)?.status).toBe('paid')
  })
  test('a stale submitting payment that cannot be found stays unreconciled and is never resent', async () => {
    const { deps, ops, db } = setup()
    insertSubmitting(db, 600)
    expect(await payInvoice(deps as any, 'inv1')).toEqual({ status: 'failed', reason: 'unreconciled' })
    expect(await payInvoice(deps as any, 'inv1')).toEqual({ status: 'failed', reason: 'unreconciled' })
    expect(ops.send).not.toHaveBeenCalled()
    expect(ops.preflight).not.toHaveBeenCalled()
  })
  test('a stale submitting payment seen under the org lock is reconciled too, never resent', async () => {
    const { deps, ops, db } = setup()
    // the row appears while payInvoice verifies (after its first read, before the locked re-read)
    ops.resolveRecipient.mockImplementationOnce(async (to: any) => {
      insertSubmitting(db, 300)
      return { effective: to, isVirtual: false, masterId: null, registered: true }
    })
    ops.findPaymentByMemo.mockResolvedValueOnce('0xbbb')
    expect(await payInvoice(deps as any, 'inv1')).toEqual({ status: 'paid', txHash: '0xbbb' })
    expect(ops.send).not.toHaveBeenCalled()
    expect(ops.preflight).not.toHaveBeenCalled()
  })
})

describe('production chain ops error mapping', () => {
  // core builds viem clients from its own viem instance: errors must be recognised by name, not only instanceof
  class TransactionReceiptNotFoundError extends Error { override name = 'TransactionReceiptNotFoundError' }
  const opsWith = (pub: any) => productionChainOps({ db: createDb(':memory:'), chain: { network: 'testnet', token: '0x20c0000000000000000000000000000000000000', pub } as any, config: {} as any })

  test('getReceipt maps a (foreign-instance) receipt-not-found error to null and passes other errors through', async () => {
    expect(await opsWith({ getTransactionReceipt: async () => { throw new TransactionReceiptNotFoundError('nope') } }).getReceipt('0x01')).toBeNull()
    expect(await opsWith({ getTransactionReceipt: async () => ({ status: 'success' }) }).getReceipt('0x01')).toBe('success')
    expect(await opsWith({ getTransactionReceipt: async () => ({ status: 'reverted' }) }).getReceipt('0x01')).toBe('reverted')
    // anything else is not a verdict on the payment
    expect(await opsWith({ getTransactionReceipt: async () => ({ status: 'weird' }) }).getReceipt('0x01')).toBeNull()
    expect(await opsWith({ getTransactionReceipt: async () => ({}) }).getReceipt('0x01')).toBeNull()
    await expect(opsWith({ getTransactionReceipt: async () => { throw new Error('503') } }).getReceipt('0x01')).rejects.toThrow('503')
  })

  test('send failures: only explicit pre-broadcast rejections are "not sent"; everything else may have been sent', () => {
    const unknown = new PaymentOutcomeUnknown('0xabc', new Error('502'))
    expect(mapSendError(unknown)).toBe(unknown)
    const foreignUnknown = Object.assign(new Error('x'), { name: 'PaymentOutcomeUnknown', txHash: '0xdef' })
    expect(mapSendError(foreignUnknown)).toBe(foreignUnknown)
    const rejected = mapSendError(new PaymentRejected('CallNotAllowed', 'nope'))
    expect(rejected).toBeInstanceOf(PaymentNotSent)
    expect((rejected as PaymentNotSent).code).toBe('CallNotAllowed')
    const foreignRejected = mapSendError(Object.assign(new Error('nope'), { name: 'PaymentRejected', code: 'SpendingLimitExceeded' }))
    expect((foreignRejected as PaymentNotSent).code).toBe('SpendingLimitExceeded')
    // core's own pre-broadcast guard
    expect(mapSendError(new Error('Refusing to run: client is not a Tempo client (chain id 1; expected 4217 or 42431).'))).toBeInstanceOf(PaymentNotSent)
    // unrecognised: maybe sent
    const odd = new Error('socket hang up')
    expect(mapSendError(odd)).toBe(odd)
    expect(mapSendError(odd)).not.toBeInstanceOf(PaymentNotSent)
  })

  test('an unrecognised error after send leaves the payment unknown', async () => {
    const { deps, ops, db } = setup()
    ops.send.mockImplementationOnce(async () => { throw mapSendError(new Error('ECONNRESET')) })
    expect(await payInvoice(deps as any, 'inv1')).toMatchObject({ status: 'failed', reason: 'rpc_error' })
    expect(paymentRow(db)?.status).toBe('unknown')
    await payInvoice(deps as any, 'inv1')
    expect(ops.send).toHaveBeenCalledOnce()
  })

  test('production send: a failure loading the agent key is "not sent"', async () => {
    const ops = opsWith({})
    await expect(ops.send({ orgId: 'missing', to: acme, amount: 1n, memo: '0x00' })).rejects.toBeInstanceOf(PaymentNotSent)
  })

  test('isUniqueViolation matches UNIQUE constraint failures only', () => {
    expect(isUniqueViolation({ code: 'SQLITE_CONSTRAINT_UNIQUE', message: 'UNIQUE constraint failed: payments.invoice_id' })).toBe(true)
    expect(isUniqueViolation({ code: 'SQLITE_CONSTRAINT_NOTNULL', message: 'NOT NULL constraint failed: payments.memo' })).toBe(false)
    expect(isUniqueViolation(new Error('boom'))).toBe(false)
  })
})

describe('duplicate invoices', () => {
  const beta = '0x6666666666666666666666666666666666666666'
  function dupSetup(inv2: { address: string; invoiceNo: string }) {
    const s = setup([root, acme, beta, '0x83196cf2' + 'fd'.repeat(10) + '000000000001'])
    s.db.insert(payees).values({ wallet: beta, legalName: 'Beta Ltd', domain: 'beta.com', lei: '', masterId: '0x00000000', level: 1, activeFrom: 1, evidenceHash: '0x00', updatedBlock: 1 }).run()
    s.db.insert(invoices).values({ id: 'inv2', orgId: 'org1', raw: 'x', payeeName: inv2.address === beta ? 'Beta Ltd' : 'Acme Ltd', address: inv2.address, amountBase: '100000000', currency: 'USDC', invoiceNo: inv2.invoiceNo, createdAt: 2 }).run()
    return s
  }
  test('a second invoice row with the same invoice number and payee is blocked; nothing is sent', async () => {
    const { deps, ops, db } = dupSetup({ address: acme, invoiceNo: 'INV-1042' })
    expect((await payInvoice(deps as any, 'inv1')).status).toBe('paid')
    const r = await payInvoice(deps as any, 'inv2')
    expect(r).toEqual({ status: 'blocked', reason: 'duplicate_invoice' })
    expect(ops.send).toHaveBeenCalledOnce()
    expect(db.select().from(invoices).where(eq(invoices.id, 'inv2')).get()?.status).toBe('blocked')
    const ev = db.select().from(events).where(and(eq(events.invoiceId, 'inv2'), eq(events.kind, 'blocked'))).all()
    expect(ev.map((e) => JSON.parse(e.detailJson).reason)).toEqual(['duplicate_invoice'])
    expect(db.select().from(payments).where(eq(payments.invoiceId, 'inv2')).get()).toBeUndefined()
  })
  test('the same invoice number to a different payee still pays', async () => {
    const { deps, ops } = dupSetup({ address: beta, invoiceNo: 'INV-1042' })
    await payInvoice(deps as any, 'inv1')
    expect((await payInvoice(deps as any, 'inv2')).status).toBe('paid')
    expect(ops.send).toHaveBeenCalledTimes(2)
  })
  test('a duplicate of a reverted payment may pay', async () => {
    const { deps, ops } = dupSetup({ address: acme, invoiceNo: 'INV-1042' })
    ops.send.mockResolvedValueOnce({ txHash: '0xeee', status: 'reverted' } as any)
    expect((await payInvoice(deps as any, 'inv1')).status).toBe('failed')
    expect((await payInvoice(deps as any, 'inv2')).status).toBe('paid')
    expect(ops.send).toHaveBeenCalledTimes(2)
  })
  test('a guarded lab payment to a real payee counts: a real invoice duplicating it is blocked', async () => {
    const { deps, ops, db } = dupSetup({ address: acme, invoiceNo: 'INV-1042' })
    db.update(invoices).set({ lab: 1 }).where(eq(invoices.id, 'inv1')).run()
    expect((await payInvoice(deps as any, 'inv1')).status).toBe('paid') // real money moved to Acme with this memo
    expect(await payInvoice(deps as any, 'inv2')).toEqual({ status: 'blocked', reason: 'duplicate_invoice' })
    expect(ops.send).toHaveBeenCalledOnce()
  })
  test('duplicates are matched on the effective payee (a virtual address of the same master)', async () => {
    const virtual = '0x83196cf2' + 'fd'.repeat(10) + '000000000001'
    const { deps, ops } = dupSetup({ address: virtual, invoiceNo: 'INV-1042' })
    ops.resolveRecipient.mockImplementation(async (to: any) => (to.toLowerCase() === virtual ? { effective: acme, isVirtual: true, masterId: '0x83196cf2', registered: true } : { effective: to, isVirtual: false, masterId: null, registered: true }) as any)
    await payInvoice(deps as any, 'inv1')
    expect(await payInvoice(deps as any, 'inv2')).toEqual({ status: 'blocked', reason: 'duplicate_invoice' })
    expect(ops.send).toHaveBeenCalledOnce()
  })
})
