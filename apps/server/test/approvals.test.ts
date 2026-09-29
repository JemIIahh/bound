import { describe, expect, test, vi } from 'vitest'
import { decodeFunctionData } from 'viem'
import { Abis } from 'viem/tempo'
import { eq } from 'drizzle-orm'
import { createDb, migrate } from '../src/db/client'
import { approvals, events, invoices, orgs, payees, pins } from '../src/db/schema'
import { approvalStatus, confirmApproval, prepareApproval, rejectApproval, requestApproval } from '../src/services/approvals'
import { getOverview } from '../src/services/orgs'
import { payInvoice } from '../src/services/payments'

const root = '0x3333333333333333333333333333333333333333'
const agent = '0x4444444444444444444444444444444444444444'
const a = '0x5555555555555555555555555555555555555555'
const b = '0x6666666666666666666666666666666666666666'

function seed(verdicts: Record<string, string> = {}) {
  const db = createDb(':memory:'); migrate(db)
  db.insert(orgs).values({ id: 'org1', name: 'Buyer', rootAddress: root, agentKeyAddress: agent, agentKeyEnc: 'x', tokenHash: 'h', limitBase: '1', periodSeconds: 1, authorized: 1, createdAt: 1 }).run()
  for (const [id, w] of [['ap1', a], ['ap2', b]] as const) {
    db.insert(approvals).values({ id, orgId: 'org1', invoiceId: 'i-' + id, wallet: w, label: w, verdictJson: JSON.stringify({ verdict: verdicts[id] ?? 'MATCH' }), createdAt: 1 }).run()
  }
  const ops = { readAllowlist: vi.fn(async () => [root] as any) } as any
  return { db, deps: { db, chain: { token: '0x20c0000000000000000000000000000000000000' } as any, config: {} as any, ops } }
}

test('concurrent prepares never drop each other (pending prepared wallets are carried forward)', async () => {
  const { deps } = seed()
  // The live allowlist stays [root] because neither tx has been sent yet.
  const [p1, p2] = await Promise.all([prepareApproval(deps as any, 'org1', 'ap1'), prepareApproval(deps as any, 'org1', 'ap2')])
  const sets = [p1.recipients, p2.recipients].sort((x, y) => x.length - y.length)
  expect(sets[0]).toEqual([root, sets[0]![1]])
  expect(new Set(sets[1])).toEqual(new Set([root, a, b]))
  const last = p1.recipients.length > p2.recipients.length ? p1 : p2
  const d = decodeFunctionData({ abi: Abis.accountKeychain, data: last.call.data })
  expect(new Set((d.args as any)[1][0].selectorRules[0].recipients)).toEqual(new Set([root, a, b]))
})

test('prepare refuses a LOOKALIKE approval', async () => {
  const { deps } = seed({ ap1: 'LOOKALIKE' })
  await expect(prepareApproval(deps as any, 'org1', 'ap1')).rejects.toMatchObject({ status: 409 })
})

test('approving a successor wallet swaps out the old pinned wallet', async () => {
  const { deps, db } = seed()
  db.insert(pins).values({ orgId: 'org1', wallet: a, label: 'Acme Ltd', approvedAt: 1, active: 1 }).run()
  db.insert(payees).values({ wallet: a, legalName: 'Acme Ltd', domain: 'acme.com', lei: '', masterId: '0x00000000', level: 1, activeFrom: 1, supersededAt: 5, successor: b, evidenceHash: '0x00', updatedBlock: 1 }).run()
  deps.ops.readAllowlist = vi.fn(async () => [root, a] as any)
  const p = await prepareApproval(deps as any, 'org1', 'ap2')
  expect(p.recipients).toEqual([root, b])
})

describe('prepare guards', () => {
  test('refuses CHANGED and REVOKED approvals too', async () => {
    const { deps } = seed({ ap1: 'CHANGED', ap2: 'REVOKED' })
    await expect(prepareApproval(deps as any, 'org1', 'ap1')).rejects.toMatchObject({ status: 409 })
    await expect(prepareApproval(deps as any, 'org1', 'ap2')).rejects.toMatchObject({ status: 409 })
  })
  test('refuses a wallet the registry mirror now shows as superseded or revoked', async () => {
    const { deps, db } = seed()
    db.insert(payees).values({ wallet: a, legalName: 'Acme Ltd', domain: 'acme.com', lei: '', masterId: '0x00000000', level: 1, activeFrom: 1, revokedAt: 9, evidenceHash: '0x00', updatedBlock: 1 }).run()
    await expect(prepareApproval(deps as any, 'org1', 'ap1')).rejects.toMatchObject({ status: 409 })
  })
  test('refuses when the allowlist is full', async () => {
    const { deps } = seed()
    const full = Array.from({ length: 57 }, (_, i) => '0x' + (i + 1).toString(16).padStart(40, '0'))
    deps.ops.readAllowlist = vi.fn(async () => full as any)
    await expect(prepareApproval(deps as any, 'org1', 'ap1')).rejects.toMatchObject({ status: 409 })
  })
  test('refuses when the key is unrestricted', async () => {
    const { deps } = seed()
    const { AllowlistError } = await import('@bound/core')
    deps.ops.readAllowlist = vi.fn(async () => { throw new AllowlistError('unrestricted: key has no call scopes (any call allowed).') })
    await expect(prepareApproval(deps as any, 'org1', 'ap1')).rejects.toMatchObject({ status: 409 })
  })
  test('404 for another org\'s approval', async () => {
    const { deps } = seed()
    await expect(prepareApproval(deps as any, 'org2', 'ap1')).rejects.toMatchObject({ status: 404 })
  })
  test('uses the effective address: a virtual address whose master is revoked is refused', async () => {
    const { deps, db } = seed()
    const virtual = '0x83196cf2' + 'fd'.repeat(10) + '000000000001'
    db.update(approvals).set({ wallet: virtual }).where(eq(approvals.id, 'ap1')).run()
    db.insert(payees).values({ wallet: a, legalName: 'Acme Ltd', domain: 'acme.com', lei: '', masterId: '0x83196cf2', level: 1, activeFrom: 1, revokedAt: 9, evidenceHash: '0x00', updatedBlock: 1 }).run()
    deps.ops.resolveRecipient = vi.fn(async () => ({ effective: a, isVirtual: true, masterId: '0x83196cf2', registered: true }))
    await expect(prepareApproval(deps as any, 'org1', 'ap1')).rejects.toMatchObject({ status: 409 })
    expect(deps.ops.resolveRecipient).toHaveBeenCalled()
  })
})

describe('carried wallets', () => {
  test('`carried` lists exactly the wallets included only because other approvals are prepared', async () => {
    const { deps } = seed()
    const p1 = await prepareApproval(deps as any, 'org1', 'ap1')
    expect(p1).toMatchObject({ recipients: [root, a], carried: [] })
    const p2 = await prepareApproval(deps as any, 'org1', 'ap2')
    expect(p2).toMatchObject({ recipients: [root, a, b], carried: [a] })
    // once a is live on the allowlist it is no longer "carried"
    deps.ops.readAllowlist = vi.fn(async () => [root, a] as any)
    const p3 = await prepareApproval(deps as any, 'org1', 'ap2')
    expect(p3).toMatchObject({ recipients: [root, a, b], carried: [] })
  })
  test('a prepared approval older than 15 minutes is not carried and reads as pending', async () => {
    const { deps, db } = seed()
    await prepareApproval(deps as any, 'org1', 'ap1')
    db.update(approvals).set({ preparedAt: Math.floor(Date.now() / 1000) - 16 * 60 }).where(eq(approvals.id, 'ap1')).run()
    const p2 = await prepareApproval(deps as any, 'org1', 'ap2')
    expect(p2).toMatchObject({ recipients: [root, b], carried: [] })
    const ap1 = db.select().from(approvals).where(eq(approvals.id, 'ap1')).get()!
    expect(approvalStatus(ap1)).toBe('pending')
    deps.ops.remainingLimit = vi.fn(async () => 0n)
    const ov = await getOverview(deps as any, 'org1')
    expect(Object.fromEntries(ov.approvals.map((x: any) => [x.id, x.status]))).toEqual({ ap1: 'pending', ap2: 'prepared' })
    // and it can be prepared again
    const again = await prepareApproval(deps as any, 'org1', 'ap1')
    expect(again).toMatchObject({ recipients: [root, b, a], carried: [b] })
  })
  test('successor replacement covers carried wallets too: a superseded wallet is never re-added', async () => {
    const { deps, db } = seed()
    const c = '0x7777777777777777777777777777777777777777'
    db.insert(approvals).values({ id: 'ap3', orgId: 'org1', invoiceId: 'i-ap3', wallet: c, label: c, verdictJson: JSON.stringify({ verdict: 'MATCH' }), createdAt: 1 }).run()
    db.insert(pins).values({ orgId: 'org1', wallet: a, label: 'Acme Ltd', approvedAt: 1, active: 1 }).run()
    db.insert(payees).values({ wallet: a, legalName: 'Acme Ltd', domain: 'acme.com', lei: '', masterId: '0x00000000', level: 1, activeFrom: 1, supersededAt: 5, successor: b, evidenceHash: '0x00', updatedBlock: 1 }).run()
    deps.ops.readAllowlist = vi.fn(async () => [root, a] as any)
    expect((await prepareApproval(deps as any, 'org1', 'ap2')).recipients).toEqual([root, b])
    const p3 = await prepareApproval(deps as any, 'org1', 'ap3')
    expect(p3.recipients).toEqual([root, b, c])
    expect(p3.carried).toEqual([b])
  })
})

function withPayment(deps: any, db: any) {
  db.insert(payees).values({ wallet: b, legalName: 'Beta Ltd', domain: 'beta.com', lei: '', masterId: '0x00000000', level: 1, activeFrom: 1, evidenceHash: '0x00', updatedBlock: 1 }).run()
  db.insert(invoices).values({ id: 'i-ap2', orgId: 'org1', raw: 'x', payeeName: 'Beta Ltd', address: b, amountBase: '5000000', currency: 'USDC', invoiceNo: 'B-1', status: 'awaiting_approval', createdAt: 1 }).run()
  Object.assign(deps.ops, {
    resolveRecipient: vi.fn(async (to: any) => ({ effective: to, isVirtual: false, masterId: null, registered: true })),
    preflight: vi.fn(async () => ({ ok: true })),
    send: vi.fn(async () => ({ txHash: '0xfeed', status: 'success' })),
    waitReceipt: vi.fn(async () => ({ status: 'success' })),
    getReceipt: vi.fn(async () => null),
    findPaymentByMemo: vi.fn(async () => null),
    readPayee: vi.fn(async () => null),
  })
}

const TX = ('0x' + 'ab'.repeat(32)) as `0x${string}`

describe('confirm', () => {
  test('cancelled popup: only the confirmed approval is approved + pinned; the carried wallet stays unpinned and still ASKs', async () => {
    const { deps, db } = seed({ ap1: 'NO_MATCH' })
    withPayment(deps, db)
    db.insert(invoices).values({ id: 'i-ap1', orgId: 'org1', raw: 'x', payeeName: 'Stranger Co', address: a, amountBase: '1000000', currency: 'USDC', invoiceNo: 'S-1', status: 'awaiting_approval', createdAt: 1 }).run()
    await prepareApproval(deps as any, 'org1', 'ap1') // the human closes this popup without signing
    const p2 = await prepareApproval(deps as any, 'org1', 'ap2')
    expect(p2.carried).toEqual([a])
    deps.ops.readAllowlist = vi.fn(async () => [root, a, b] as any) // ap2's tx (carrying a) lands
    const r = await confirmApproval(deps as any, 'org1', 'ap2', TX)
    expect(r).toMatchObject({ approved: true, payment: { status: 'paid', txHash: '0xfeed' } })
    expect(deps.ops.waitReceipt).toHaveBeenCalledWith(TX)
    const status = Object.fromEntries(db.select().from(approvals).all().map((x) => [x.id, x.status]))
    expect(status).toEqual({ ap1: 'prepared', ap2: 'approved' })
    expect(db.select().from(pins).all().map((p) => p.wallet)).toEqual([b])
    expect(db.select().from(events).where(eq(events.kind, 'approved')).all()).toHaveLength(1)
    expect(db.select().from(invoices).where(eq(invoices.id, 'i-ap2')).get()?.status).toBe('paid')
    // a is allowlisted but not pinned: a NO_MATCH payee there still needs a human
    const p = await payInvoice(deps as any, 'i-ap1')
    expect(p).toMatchObject({ status: 'asked', approvalId: 'ap1' })
    expect(deps.ops.send).toHaveBeenCalledOnce()
  })
  test('409 when the wallet is not on the live allowlist', async () => {
    const { deps, db } = seed()
    withPayment(deps, db)
    await prepareApproval(deps as any, 'org1', 'ap2')
    await expect(confirmApproval(deps as any, 'org1', 'ap2', TX)).rejects.toMatchObject({ status: 409 })
    expect(db.select().from(approvals).where(eq(approvals.id, 'ap2')).get()?.status).toBe('prepared')
    expect(deps.ops.send).not.toHaveBeenCalled()
  })
  test('409 when the allowlist tx reverted', async () => {
    const { deps, db } = seed()
    withPayment(deps, db)
    deps.ops.waitReceipt = vi.fn(async () => ({ status: 'reverted' }))
    deps.ops.readAllowlist = vi.fn(async () => [root, b] as any)
    await expect(confirmApproval(deps as any, 'org1', 'ap2', TX)).rejects.toMatchObject({ status: 409 })
  })
  test('refuses to approve a LOOKALIKE even if the wallet is on the allowlist', async () => {
    const { deps, db } = seed({ ap2: 'LOOKALIKE' })
    withPayment(deps, db)
    deps.ops.readAllowlist = vi.fn(async () => [root, b] as any)
    await expect(confirmApproval(deps as any, 'org1', 'ap2', TX)).rejects.toMatchObject({ status: 409 })
    expect(db.select().from(pins).all()).toHaveLength(0)
  })
  test('confirming a successor deactivates the replaced wallet\'s pin', async () => {
    const { deps, db } = seed()
    db.insert(pins).values({ orgId: 'org1', wallet: a, label: 'Acme Ltd', approvedAt: 1, active: 1 }).run()
    db.insert(payees).values({ wallet: a, legalName: 'Acme Ltd', domain: 'acme.com', lei: '', masterId: '0x00000000', level: 1, activeFrom: 1, supersededAt: 5, successor: b, evidenceHash: '0x00', updatedBlock: 1 }).run()
    withPayment(deps, db)
    deps.ops.readAllowlist = vi.fn(async () => [root, a] as any)
    await prepareApproval(deps as any, 'org1', 'ap2')
    deps.ops.readAllowlist = vi.fn(async () => [root, b] as any)
    await confirmApproval(deps as any, 'org1', 'ap2', TX)
    const byWallet = Object.fromEntries(db.select().from(pins).all().map((p) => [p.wallet, p.active]))
    expect(byWallet).toEqual({ [a]: 0, [b]: 1 })
  })
})

describe('request / reject', () => {
  test('requestApproval reuses a pending or prepared approval for the same org + wallet', async () => {
    const { deps } = seed()
    const r1 = await requestApproval(deps as any, { orgId: 'org1', invoiceId: 'i-x', wallet: a.toLowerCase() as any, label: 'A', verdict: { verdict: 'NO_MATCH' } as any })
    expect(r1.id).toBe('ap1')
    await prepareApproval(deps as any, 'org1', 'ap1')
    const r2 = await requestApproval(deps as any, { orgId: 'org1', invoiceId: 'i-y', wallet: a as any, label: 'A', verdict: { verdict: 'NO_MATCH' } as any })
    expect(r2.id).toBe('ap1')
    const r3 = await requestApproval(deps as any, { orgId: 'org1', invoiceId: 'i-z', wallet: '0x7777777777777777777777777777777777777777' as any, label: 'C', verdict: { verdict: 'NO_MATCH' } as any })
    expect(r3.id).not.toBe('ap1')
    expect(r3.status).toBe('pending')
  })
  test('reject blocks the invoice and a later payInvoice does not ask again', async () => {
    const { deps, db } = seed()
    withPayment(deps, db)
    const r = await rejectApproval(deps as any, 'org1', 'ap2')
    expect(r).toEqual({ rejected: true })
    expect(db.select().from(approvals).where(eq(approvals.id, 'ap2')).get()?.status).toBe('rejected')
    expect(db.select().from(invoices).where(eq(invoices.id, 'i-ap2')).get()?.status).toBe('blocked')
    const p = await payInvoice(deps as any, 'i-ap2')
    expect(p.status).toBe('blocked')
    expect(db.select().from(approvals).all()).toHaveLength(2)
    expect(deps.ops.send).not.toHaveBeenCalled()
  })
  test('cannot reject an approved approval', async () => {
    const { deps, db } = seed()
    db.update(approvals).set({ status: 'approved' }).where(eq(approvals.id, 'ap1')).run()
    await expect(rejectApproval(deps as any, 'org1', 'ap1')).rejects.toMatchObject({ status: 409 })
  })
})
