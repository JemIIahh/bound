import { expect, test, vi } from 'vitest'
import request from 'supertest'
import { eq } from 'drizzle-orm'
import { createDb, migrate } from '../src/db/client'
import { events, orgs, payees, pins } from '../src/db/schema'
import { createApp, finalize } from '../src/app'
import { verifyRouter } from '../src/routes/verify'
import { verifyPayee } from '../src/services/verify-service'

const acme = '0xCcB7f43C7D6DBbC4e545d8C01761098da5332ED2'
const root = '0x3333333333333333333333333333333333333333'
const agent = '0x4444444444444444444444444444444444444444'

test('POST /v1/verify returns verdict + action', async () => {
  const db = createDb(':memory:'); migrate(db)
  db.insert(payees).values({ wallet: acme, legalName: 'Acme Ltd', domain: 'acme.com', lei: '', masterId: '0x00000000', level: 1, activeFrom: 1, evidenceHash: '0x00', updatedBlock: 1 }).run()
  const ops = { resolveRecipient: vi.fn(async (to: any) => ({ effective: to, isVirtual: false, masterId: null, registered: true })), readPayee: vi.fn(async () => null) }
  const deps = { db, chain: { network: 'testnet' } as any, config: { webOrigin: '*' } as any, ops } as any
  const app = createApp(deps); app.use('/v1', verifyRouter(deps)); finalize(app)
  const ok = await request(app).post('/v1/verify').send({ address: acme, payeeName: 'ACME Limited' })
  expect(ok.body).toMatchObject({ verdict: 'MATCH', action: 'ASK' })
  expect(typeof ok.body.checkId).toBe('string')
  const look = await request(app).post('/v1/verify').send({ address: '0xccb7' + '1'.repeat(32) + '2ed2', payeeName: 'Acme Ltd', senderDomain: 'acme-ltd.co' })
  expect(look.body).toMatchObject({ verdict: 'LOOKALIKE', action: 'BLOCK' })
  const bad = await request(app).post('/v1/verify').send({ address: 'nope' })
  expect(bad.status).toBe(400)
  // public checks are not persisted
  expect(db.select().from(events).all()).toHaveLength(0)
})

function orgSetup() {
  const db = createDb(':memory:'); migrate(db)
  db.insert(orgs).values({ id: 'org1', name: 'Buyer', rootAddress: root, agentKeyAddress: agent, agentKeyEnc: 'x', tokenHash: 'h', limitBase: '1', periodSeconds: 1, authorized: 1, createdAt: 1 }).run()
  db.insert(payees).values({ wallet: acme, legalName: 'Acme Ltd', domain: 'acme.com', lei: '', masterId: '0x83196cf2', level: 1, activeFrom: 1, evidenceHash: '0x00', updatedBlock: 1 }).run()
  return db
}

test('verifyPayee loads the payee by the RESOLVED address; pinned/allowlisted use the literal destination', async () => {
  const db = orgSetup()
  const virtual = '0x83196cf2' + 'fd'.repeat(10) + '000000000001'
  db.insert(pins).values({ orgId: 'org1', wallet: virtual, label: 'Acme Ltd', approvedAt: 1, active: 1 }).run()
  const ops = {
    resolveRecipient: vi.fn(async () => ({ effective: acme, isVirtual: true, masterId: '0x83196cf2', registered: true })),
    readAllowlist: vi.fn(async () => [root, virtual] as any),
    readPayee: vi.fn(async () => null),
  }
  const r = await verifyPayee({ db, chain: {} as any, config: {} as any, ops } as any, { address: virtual as any, payeeName: 'Acme Ltd', orgId: 'org1' })
  expect(r).toMatchObject({ verdict: 'MATCH', action: 'PAY', pinned: true, allowlisted: true, isVirtual: true, effectiveAddress: acme })
  expect(r.payee?.legalName).toBe('Acme Ltd')
  expect(ops.readAllowlist).toHaveBeenCalledWith(root, agent)
  expect(ops.readPayee).not.toHaveBeenCalled()
  // org-scoped checks are counted
  const checks = db.select().from(events).where(eq(events.kind, 'check')).all()
  expect(checks).toHaveLength(1)
  expect(checks[0]).toMatchObject({ id: r.checkId, orgId: 'org1' })
})

test('verifyPayee falls back to the onchain registry when the mirror has no record', async () => {
  const db = orgSetup()
  const fresh = '0x9999999999999999999999999999999999999999'
  const ops = {
    resolveRecipient: vi.fn(async (to: any) => ({ effective: to, isVirtual: false, masterId: null, registered: true })),
    readAllowlist: vi.fn(async () => [root] as any),
    readPayee: vi.fn(async (w: any) => ({ wallet: w, legalName: 'Fresh Co', domain: 'fresh.co', lei: '', masterId: '0x00000000', level: 1, verifiedAt: 1, activeFrom: 1, supersededAt: 0, revokedAt: 0, successor: null, evidenceHash: '0x00' })),
  }
  const r = await verifyPayee({ db, chain: {} as any, config: {} as any, ops } as any, { address: fresh as any, payeeName: 'Fresh Co', orgId: 'org1' })
  expect(ops.readPayee).toHaveBeenCalledWith(fresh)
  expect(r).toMatchObject({ verdict: 'MATCH', action: 'ASK', allowlisted: false })
})

test('a pin from another org does not count', async () => {
  const db = orgSetup()
  db.insert(pins).values({ orgId: 'org2', wallet: acme, label: 'Acme Ltd', approvedAt: 1, active: 1 }).run()
  const ops = {
    resolveRecipient: vi.fn(async (to: any) => ({ effective: to, isVirtual: false, masterId: null, registered: true })),
    readAllowlist: vi.fn(async () => [root] as any),
    readPayee: vi.fn(async () => null),
  }
  const r = await verifyPayee({ db, chain: {} as any, config: {} as any, ops } as any, { address: acme as any, payeeName: 'Acme Ltd', orgId: 'org1' })
  expect(r.pinned).toBe(false)
})

test('a superseded incumbent keeps its domain age: after a wallet rotation only the newer lookalike is flagged', async () => {
  const db = createDb(':memory:'); migrate(db)
  const acmeOld = '0x1111111111111111111111111111111111111111'
  const acmeNew = '0x2222222222222222222222222222222222222222'
  const acne = '0x5555555555555555555555555555555555555555'
  const row = { lei: '', masterId: '0x00000000', level: 1, evidenceHash: '0x00', updatedBlock: 1 }
  // acme.com registered at t=100, acne.com at t=1000, then Acme rotated to a new wallet at t=5000
  db.insert(payees).values({ ...row, wallet: acmeOld, legalName: 'Acme Ltd', domain: 'acme.com', activeFrom: 100, supersededAt: 5000, successor: acmeNew }).run()
  db.insert(payees).values({ ...row, wallet: acne, legalName: 'Acne Inc', domain: 'acne.com', activeFrom: 1000 }).run()
  db.insert(payees).values({ ...row, wallet: acmeNew, legalName: 'Acme Ltd', domain: 'acme.com', activeFrom: 5000 }).run()
  // a revoked registration never counts towards a domain's age
  db.insert(payees).values({ ...row, wallet: '0x6666666666666666666666666666666666666666', legalName: 'Acne Inc', domain: 'acne.com', activeFrom: 1, revokedAt: 50 }).run()
  const ops = { resolveRecipient: vi.fn(async (to: any) => ({ effective: to, isVirtual: false, masterId: null, registered: true })), readPayee: vi.fn(async () => null) }
  const deps = { db, chain: {} as any, config: {} as any, ops } as any

  const incumbent = await verifyPayee(deps, { address: acmeNew as any, payeeName: 'Acme Ltd' })
  expect(incumbent.verdict).toBe('MATCH')
  expect(incumbent.reasons.map((x) => x.code)).not.toContain('lookalike_domain')

  const newcomer = await verifyPayee(deps, { address: acne as any, payeeName: 'Acne Inc' })
  expect(newcomer.verdict).toBe('CLOSE_MATCH')
  expect(newcomer.reasons.filter((x) => x.code === 'lookalike_domain').map((x) => x.detail)).toEqual(['acne.com imitates acme.com (Acme Ltd)'])
})
