import { describe, expect, test, vi } from 'vitest'
import { AllowlistError, PaymentOutcomeUnknown, PaymentRejected } from '@bound/core'
import { createDb, migrate } from '../src/db/client'
import { events, invoices, orgs, payees, payments, pins } from '../src/db/schema'
import { mapSendError, payInvoice, PaymentNotSent, productionChainOps } from '../src/services/payments'
import { verifyPayee } from '../src/services/verify-service'
import { eq } from 'drizzle-orm'

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
  test('over the spending limit → asked with over_limit', async () => {
    const { deps, ops } = setup()
    ops.preflight.mockResolvedValueOnce({ ok: false, code: 'SpendingLimitExceeded', message: 'limit' } as any)
    const r = await payInvoice(deps as any, 'inv1')
    expect(r).toMatchObject({ status: 'asked', reason: 'over_limit' })
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

describe('production chain ops error mapping', () => {
  // core builds viem clients from its own viem instance: errors must be recognised by name, not only instanceof
  class TransactionReceiptNotFoundError extends Error { override name = 'TransactionReceiptNotFoundError' }
  const opsWith = (pub: any) => productionChainOps({ db: createDb(':memory:'), chain: { network: 'testnet', token: '0x20c0000000000000000000000000000000000000', pub } as any, config: {} as any })

  test('getReceipt maps a (foreign-instance) receipt-not-found error to null and passes other errors through', async () => {
    expect(await opsWith({ getTransactionReceipt: async () => { throw new TransactionReceiptNotFoundError('nope') } }).getReceipt('0x01')).toBeNull()
    expect(await opsWith({ getTransactionReceipt: async () => ({ status: 'success' }) }).getReceipt('0x01')).toBe('success')
    expect(await opsWith({ getTransactionReceipt: async () => ({ status: 'reverted' }) }).getReceipt('0x01')).toBe('reverted')
    await expect(opsWith({ getTransactionReceipt: async () => { throw new Error('503') } }).getReceipt('0x01')).rejects.toThrow('503')
  })

  test('send failures: a tx hash means "maybe broadcast" (kept), anything else means not sent', () => {
    const unknown = new PaymentOutcomeUnknown('0xabc', new Error('502'))
    expect(mapSendError(unknown)).toBe(unknown)
    const foreignUnknown = Object.assign(new Error('x'), { name: 'PaymentOutcomeUnknown', txHash: '0xdef' })
    expect(mapSendError(foreignUnknown)).toBe(foreignUnknown)
    const rejected = mapSendError(new PaymentRejected('CallNotAllowed', 'nope'))
    expect(rejected).toBeInstanceOf(PaymentNotSent)
    expect((rejected as PaymentNotSent).code).toBe('CallNotAllowed')
    expect(mapSendError(new Error('Refusing to run: client is not a Tempo client'))).toBeInstanceOf(PaymentNotSent)
  })
})
