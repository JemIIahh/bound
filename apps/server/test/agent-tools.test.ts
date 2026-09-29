import { describe, expect, test, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createDb, migrate } from '../src/db/client'
import { events, invoices, orgs, payees, payments } from '../src/db/schema'
import { buildTools, rawTransfer, recordInvoiceFields } from '../src/agent/tools'
import { PaymentOutcomeUnknown } from '@bound/core'
import { PaymentNotSent } from '../src/services/payments'
import { withOrgLock } from '../src/services/mutex'

const root = '0x3333333333333333333333333333333333333333'
const acme = '0xCcB7f43C7D6DBbC4e545d8C01761098da5332ED2'
const attacker = '0x7777777777777777777777777777777777777777'

function setup() {
  const db = createDb(':memory:'); migrate(db)
  db.insert(orgs).values({ id: 'org1', name: 'Buyer', rootAddress: root, agentKeyAddress: '0x' + '44'.repeat(20), agentKeyEnc: 'x', tokenHash: 'h', limitBase: '1', periodSeconds: 1, authorized: 1, createdAt: 1 }).run()
  db.insert(invoices).values({ id: 'inv1', orgId: 'org1', raw: 'x', createdAt: 1 }).run()
  return { db }
}

const invoice = (db: ReturnType<typeof setup>['db']) => db.select().from(invoices).where(eq(invoices.id, 'inv1')).get()!

describe('recordInvoiceFields', () => {
  test('stores parsed base units and normalized domain', async () => {
    const { db } = setup()
    const out = await recordInvoiceFields({ db } as any, 'inv1', { payeeName: 'Acme Ltd', address: '0xCcB7f43C7D6DBbC4e545d8C01761098da5332ED2', amount: '1,250.50', currency: 'USDC', invoiceNo: 'INV-1042', senderDomain: 'Billing@Acme.com' })
    expect(out.ok).toBe(true)
    const row = invoice(db)
    expect(row.amountBase).toBe('1250500000')
    expect(row.senderDomain).toBe('acme.com')
  })
  test('rejects a bad address or amount without throwing', async () => {
    const { db } = setup()
    expect((await recordInvoiceFields({ db } as any, 'inv1', { payeeName: 'A', address: 'nope', amount: '5', currency: 'USDC', invoiceNo: '1' })).ok).toBe(false)
    expect((await recordInvoiceFields({ db } as any, 'inv1', { payeeName: 'A', address: root, amount: 'lots', currency: 'USDC', invoiceNo: '1' })).ok).toBe(false)
    expect((await recordInvoiceFields({ db } as any, 'inv1', { payeeName: 'A', address: root, amount: '0', currency: 'USDC', invoiceNo: '1' })).ok).toBe(false)
  })
  test('cannot rewrite an invoice once it has been decided or paid', async () => {
    const { db } = setup()
    const f = { payeeName: 'Acme Ltd', address: acme, amount: '10', currency: 'USDC', invoiceNo: 'INV-1' }
    expect((await recordInvoiceFields({ db } as any, 'inv1', f)).ok).toBe(true)
    db.update(invoices).set({ status: 'awaiting_approval' }).where(eq(invoices.id, 'inv1')).run()
    const r = await recordInvoiceFields({ db } as any, 'inv1', { ...f, address: attacker })
    expect(r.ok).toBe(false)
    expect(invoice(db).address).toBe(acme)
    expect(invoice(db).status).toBe('awaiting_approval')
  })
})

describe('rawTransfer (lab guard-off)', () => {
  const HASH = ('0x' + 'ab'.repeat(32)) as `0x${string}`
  const refused = (code = 'CallNotAllowed') => vi.fn(async () => ({ ok: false as const, code, message: `Account keychain error: ${code}` }))
  const fast = { receiptTimeoutMs: 50, receiptPollMs: 5 }
  function lab() {
    const s = setup()
    s.db.update(invoices).set({ lab: 1 }).where(eq(invoices.id, 'inv1')).run()
    return s
  }
  const payment = (db: ReturnType<typeof setup>['db']) => db.select().from(payments).where(eq(payments.invoiceId, 'inv1')).get()
  const eventsOf = (db: ReturnType<typeof setup>['db']) => db.select().from(events).where(eq(events.invoiceId, 'inv1')).all()

  test('refuses outside lab invoices', async () => {
    const { db } = setup()
    const ops = { preflight: vi.fn(), send: vi.fn() }
    const r = await rawTransfer({ db, ops } as any, 'inv1', { to: root, amount: '1', memo: 'X' })
    expect(r.ok).toBe(false)
    expect(ops.send).not.toHaveBeenCalled()
  })
  test('records the chain rejection with a tx hash', async () => {
    const { db } = setup()
    db.update(invoices).set({ lab: 1 }).where(eq(invoices.id, 'inv1')).run()
    const ops = {
      preflight: vi.fn(async () => ({ ok: false, code: 'CallNotAllowed', message: 'Account keychain error: CallNotAllowed' })),
      send: vi.fn(async () => ({ txHash: '0xrej', status: 'reverted' })),
    }
    const r = await rawTransfer({ db, ops } as any, 'inv1', { to: '0x' + '77'.repeat(20), amount: '10', memo: 'INV-EVIL' })
    expect(r).toMatchObject({ ok: false, chain: 'rejected', code: 'CallNotAllowed', txHash: '0xrej' })
    expect(ops.send).toHaveBeenCalledWith(expect.objectContaining({ force: true }))
    expect(invoice(db).status).toBe('blocked')
    const ev = db.select().from(events).where(eq(events.invoiceId, 'inv1')).all()
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ kind: 'chain_rejected', txHash: '0xrej' })
    expect(JSON.parse(ev[0]!.detailJson)).toMatchObject({ code: 'CallNotAllowed', lab: true })
  })
  test('sends at most once per lab invoice', async () => {
    const { db } = setup()
    db.update(invoices).set({ lab: 1 }).where(eq(invoices.id, 'inv1')).run()
    const ops = {
      preflight: vi.fn(async () => ({ ok: false, code: 'CallNotAllowed', message: 'x' })),
      send: vi.fn(async () => ({ txHash: '0xrej', status: 'reverted' })),
    }
    await rawTransfer({ db, ops } as any, 'inv1', { to: attacker, amount: '10', memo: 'INV-EVIL' })
    const again = await rawTransfer({ db, ops } as any, 'inv1', { to: attacker, amount: '10', memo: 'INV-EVIL' })
    expect(again.ok).toBe(false)
    expect(ops.send).toHaveBeenCalledOnce()
  })
  test('reports a transfer that was never broadcast without claiming a chain verdict', async () => {
    const { db } = lab()
    const ops = { preflight: refused(), send: vi.fn(async () => { throw new PaymentNotSent('Other', 'nonce fetch failed') }) }
    const r = await rawTransfer({ db, ops } as any, 'inv1', { to: attacker, amount: '10', memo: 'INV-EVIL' })
    expect(r).toMatchObject({ ok: false, chain: 'not_sent' })
    expect(invoice(db).status).toBe('failed')
    expect(payment(db)?.status).toBe('rejected')
  })
  test('refuses when the org has not authorized its agent key', async () => {
    const { db } = lab()
    db.update(orgs).set({ authorized: 0 }).where(eq(orgs.id, 'org1')).run()
    const ops = { preflight: refused(), send: vi.fn() }
    const r = await rawTransfer({ db, ops } as any, 'inv1', { to: attacker, amount: '10', memo: 'INV-EVIL' })
    expect(r).toMatchObject({ ok: false })
    expect(ops.preflight).not.toHaveBeenCalled()
    expect(ops.send).not.toHaveBeenCalled()
    expect(payment(db)).toBeUndefined()
  })
  test('a spending-limit refusal is force-sent only when the amount exceeds the FULL per-period limit', async () => {
    const { db } = lab() // org limitBase = 1 base unit, amount 10 USD: no refill can ever cover it
    const ops = { preflight: refused('SpendingLimitExceeded'), send: vi.fn(async () => ({ txHash: '0xrej', status: 'reverted' })) }
    const r = await rawTransfer({ db, ops } as any, 'inv1', { to: attacker, amount: '10', memo: 'INV-EVIL' })
    expect(r).toMatchObject({ chain: 'rejected', code: 'SpendingLimitExceeded' })
    expect(ops.send).toHaveBeenCalledOnce()
  })
  test('a spending-limit refusal within the per-period limit is never sent (a period refill could let it through)', async () => {
    for (const limitBase of ['100000000', '10000000']) { // limit 100 USD, and limit == amount (10 USD)
      const { db } = lab()
      db.update(orgs).set({ limitBase }).where(eq(orgs.id, 'org1')).run()
      const ops = { preflight: refused('SpendingLimitExceeded'), send: vi.fn() }
      const r = await rawTransfer({ db, ops } as any, 'inv1', { to: acme, amount: '10', memo: 'INV-1' })
      expect(r).toEqual({ ok: false, chain: 'not_sent', reason: 'lab only force-sends payments Tempo will refuse' })
      expect(ops.send).not.toHaveBeenCalled()
      expect(payment(db)?.status).toBe('rejected')
      expect(invoice(db).status).toBe('blocked')
    }
  })
  test('never sends when the preflight says Tempo would ACCEPT the payment', async () => {
    const { db } = lab()
    const ops = { preflight: vi.fn(async () => ({ ok: true as const })), send: vi.fn() }
    const r = await rawTransfer({ db, ops } as any, 'inv1', { to: acme, amount: '10', memo: 'INV-1' })
    expect(r).toEqual({ ok: false, chain: 'not_sent', reason: 'lab only force-sends payments Tempo will refuse' })
    expect(ops.send).not.toHaveBeenCalled()
    expect(invoice(db).status).toBe('blocked')
    expect(payment(db)?.status).toBe('rejected')
    expect(eventsOf(db).map((e) => e.kind)).toEqual(['blocked'])
  })
  test('never sends when the preflight failed to run', async () => {
    const { db } = lab()
    const ops = { preflight: vi.fn(async () => { throw new Error('rpc down') }), send: vi.fn() }
    const r = await rawTransfer({ db, ops } as any, 'inv1', { to: attacker, amount: '10', memo: 'INV-EVIL' })
    expect(r).toMatchObject({ ok: false, chain: 'not_sent' })
    expect(ops.send).not.toHaveBeenCalled()
    expect(invoice(db).status).toBe('blocked')
  })
  test('never sends on any other preflight code', async () => {
    const { db } = lab()
    const ops = { preflight: refused('Other'), send: vi.fn() }
    expect(await rawTransfer({ db, ops } as any, 'inv1', { to: attacker, amount: '10', memo: 'INV-EVIL' })).toMatchObject({ chain: 'not_sent' })
    expect(ops.send).not.toHaveBeenCalled()
  })
  test('the forced send waits for the org lock (no nonce race with a real payment)', async () => {
    const { db } = lab()
    const ops = { preflight: refused(), send: vi.fn(async () => ({ txHash: '0xrej', status: 'reverted' })) }
    let release!: () => void
    const held = withOrgLock('org1', () => new Promise<void>((r) => { release = r }))
    const pending = rawTransfer({ db, ops } as any, 'inv1', { to: attacker, amount: '10', memo: 'INV-EVIL' })
    await new Promise((r) => setTimeout(r, 20))
    expect(ops.send).not.toHaveBeenCalled()
    release(); await held
    expect(await pending).toMatchObject({ chain: 'rejected' })
    expect(ops.send).toHaveBeenCalledOnce()
  })
  test('a refused-at-preflight payment the chain nonetheless accepts is recorded as paid (defensive)', async () => {
    const { db } = lab()
    const ops = { preflight: refused(), send: vi.fn(async () => ({ txHash: '0xok', status: 'success' })) }
    const r = await rawTransfer({ db, ops } as any, 'inv1', { to: attacker, amount: '10', memo: 'INV-EVIL' })
    expect(r).toMatchObject({ ok: true, chain: 'accepted', txHash: '0xok' })
    expect(invoice(db).status).toBe('paid')
    expect(payment(db)).toMatchObject({ status: 'confirmed', txHash: '0xok' })
  })

  describe('outcome unknown after broadcast: bounded receipt wait', () => {
    const maybeSent = () => vi.fn(async () => { throw new PaymentOutcomeUnknown(HASH, new Error('502 Bad Gateway')) })
    test('a receipt that shows the revert records the chain rejection', async () => {
      const { db } = lab()
      const ops = { preflight: refused(), send: maybeSent(), getReceipt: vi.fn().mockResolvedValueOnce(null).mockResolvedValue('reverted') }
      const r = await rawTransfer({ db, ops } as any, 'inv1', { to: attacker, amount: '10', memo: 'INV-EVIL' }, fast)
      expect(r).toMatchObject({ ok: false, chain: 'rejected', code: 'CallNotAllowed', txHash: HASH })
      expect(payment(db)).toMatchObject({ status: 'reverted', txHash: HASH })
      expect(invoice(db).status).toBe('blocked')
      expect(eventsOf(db)).toEqual([expect.objectContaining({ kind: 'chain_rejected', txHash: HASH })])
    })
    test('a receipt that shows success records the payment', async () => {
      const { db } = lab()
      const ops = { preflight: refused(), send: maybeSent(), getReceipt: vi.fn(async () => 'success') }
      const r = await rawTransfer({ db, ops } as any, 'inv1', { to: attacker, amount: '10', memo: 'INV-EVIL' }, fast)
      expect(r).toMatchObject({ ok: true, chain: 'accepted', txHash: HASH })
      expect(payment(db)?.status).toBe('confirmed')
      expect(invoice(db).status).toBe('paid')
    })
    test('no receipt within the bound leaves it visibly unconfirmed, not processing', async () => {
      const { db } = lab()
      const ops = { preflight: refused(), send: maybeSent(), getReceipt: vi.fn().mockRejectedValueOnce(new Error('503')).mockResolvedValue(null) }
      const r = await rawTransfer({ db, ops } as any, 'inv1', { to: attacker, amount: '10', memo: 'INV-EVIL' }, fast)
      expect(r).toMatchObject({ ok: false, chain: 'unknown', txHash: HASH })
      expect(payment(db)).toMatchObject({ status: 'unknown', txHash: HASH })
      expect(invoice(db).status).toBe('unconfirmed')
      expect(ops.getReceipt.mock.calls.length).toBeGreaterThan(1)
    })
    test('without a tx hash there is nothing to wait for: unconfirmed', async () => {
      const { db } = lab()
      const ops = { preflight: refused(), send: vi.fn(async () => { throw new Error('socket hang up') }), getReceipt: vi.fn() }
      const r = await rawTransfer({ db, ops } as any, 'inv1', { to: attacker, amount: '10', memo: 'INV-EVIL' }, fast)
      expect(r).toMatchObject({ ok: false, chain: 'unknown' })
      expect(ops.getReceipt).not.toHaveBeenCalled()
      expect(invoice(db).status).toBe('unconfirmed')
    })
    test('the wait happens outside the org lock', async () => {
      const { db } = lab()
      let resolveReceipt!: (v: 'reverted') => void
      const ops = { preflight: refused(), send: maybeSent(), getReceipt: vi.fn(() => new Promise((r) => { resolveReceipt = r as any })) }
      const pending = rawTransfer({ db, ops } as any, 'inv1', { to: attacker, amount: '10', memo: 'INV-EVIL' }, { receiptTimeoutMs: 5_000, receiptPollMs: 5 })
      await vi.waitFor(() => expect(ops.getReceipt).toHaveBeenCalled())
      await withOrgLock('org1', async () => {}) // would hang if the lock were still held
      // crash-safe: before settling, the row already records the possibly-sent tx
      expect(payment(db)).toMatchObject({ status: 'unknown', txHash: HASH })
      resolveReceipt('reverted')
      expect(await pending).toMatchObject({ chain: 'rejected' })
    })
  })
})

describe('buildTools', () => {
  const names = (tools: { name: string }[]) => tools.map((t) => t.name)
  function deps() {
    const { db } = setup()
    db.insert(payees).values({ wallet: acme, legalName: 'Acme Ltd', domain: 'acme.com', lei: '', masterId: '0x00000000', level: 1, activeFrom: 1, evidenceHash: '0x00', updatedBlock: 1 }).run()
    const ops = {
      resolveRecipient: vi.fn(async (to: any) => ({ effective: to, isVirtual: false, masterId: null, registered: false })),
      readAllowlist: vi.fn(async () => [root] as any),
      readPayee: vi.fn(async () => null),
      preflight: vi.fn(), send: vi.fn(),
    }
    return { db, ops, chain: { network: 'testnet', token: '0x20c0000000000000000000000000000000000000' } as any, config: {} as any }
  }

  test('guarded tools never include raw_transfer; guard-off tools are only record + raw_transfer', () => {
    const d = deps()
    expect(names(buildTools(d as any, 'inv1', 'guarded'))).toEqual(['record_invoice_fields', 'verify_payee', 'pay_invoice', 'request_payee_approval', 'report_blocked'])
    expect(names(buildTools(d as any, 'inv1', 'guard_off'))).toEqual(['record_invoice_fields', 'raw_transfer'])
  })

  test('verify_payee returns the verdict reasons verbatim and logs the tool result', async () => {
    const d = deps()
    const log = vi.fn()
    const verify = buildTools(d as any, 'inv1', 'guarded', log).find((t) => t.name === 'verify_payee')!
    const out = JSON.parse(await (verify as any).run({ address: attacker, payeeName: 'Acme Ltd', senderDomain: 'acme.com' }))
    expect(out.verdict).toBe('LOOKALIKE')
    expect(out.action).toBe('BLOCK')
    expect(out.reasons.map((r: any) => r.code)).toContain('claims_verified_payee')
    expect(out.reasons.every((r: any) => typeof r.detail === 'string' && r.detail.length > 0)).toBe(true)
    expect(log).toHaveBeenCalledWith('verify_payee', expect.objectContaining({ verdict: 'LOOKALIKE', reasons: out.reasons }))
  })

  test('verify_payee persists the verdict only when it checked exactly the recorded invoice fields', async () => {
    const d = deps()
    await recordInvoiceFields(d as any, 'inv1', { payeeName: 'Acme Ltd', address: attacker, amount: '10', currency: 'USDC', invoiceNo: 'INV-1', senderDomain: 'Billing@Acme.com' })
    const verify = buildTools(d as any, 'inv1', 'guarded').find((t) => t.name === 'verify_payee') as any
    await verify.run({ address: attacker, payeeName: 'Acme Limited', senderDomain: 'acme.com' }) // other name
    await verify.run({ address: attacker, payeeName: 'Acme Ltd', senderDomain: 'other.com' }) // other domain
    await verify.run({ address: attacker, payeeName: 'Acme Ltd' }) // domain omitted
    await verify.run({ address: acme, payeeName: 'Acme Ltd', senderDomain: 'acme.com' }) // other address
    expect(invoice(d.db).verdictJson).toBeNull()
    await verify.run({ address: attacker.toLowerCase(), payeeName: ' Acme Ltd ', senderDomain: 'billing@ACME.com' }) // same after normalization
    expect(JSON.parse(invoice(d.db).verdictJson!).verdict).toBe('LOOKALIKE')
    expect(invoice(d.db).action).toBe('BLOCK')
  })

  test('pay_invoice re-verifies server-side and blocks a lookalike even when the model asks to pay', async () => {
    const d = deps()
    await recordInvoiceFields(d as any, 'inv1', { payeeName: 'Acme Ltd', address: attacker, amount: '10', currency: 'USDC', invoiceNo: 'INV-1', senderDomain: 'acme.com' })
    const pay = buildTools(d as any, 'inv1', 'guarded').find((t) => t.name === 'pay_invoice')!
    const out = JSON.parse(await (pay as any).run({}))
    expect(out.status).toBe('blocked')
    expect(out.reasons.map((r: any) => r.code)).toContain('claims_verified_payee')
    expect(d.ops.send).not.toHaveBeenCalled()
    expect(invoice(d.db).status).toBe('blocked')
  })

  test('report_blocked records the reason', async () => {
    const d = deps()
    const block = buildTools(d as any, 'inv1', 'guarded').find((t) => t.name === 'report_blocked')!
    await (block as any).run({ reason: 'Lookalike of Acme Ltd' })
    expect(invoice(d.db).status).toBe('blocked')
    const ev = d.db.select().from(events).where(eq(events.kind, 'blocked')).get()!
    expect(JSON.parse(ev.detailJson)).toMatchObject({ reason: 'Lookalike of Acme Ltd' })
  })

  test('report_blocked cannot undo a payment', async () => {
    const d = deps()
    d.db.update(invoices).set({ status: 'paid' }).where(eq(invoices.id, 'inv1')).run()
    const block = buildTools(d as any, 'inv1', 'guarded').find((t) => t.name === 'report_blocked')!
    const out = JSON.parse(await (block as any).run({ reason: 'changed my mind' }))
    expect(out.ok).toBe(false)
    expect(invoice(d.db).status).toBe('paid')
  })
})
