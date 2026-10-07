import { describe, expect, test, vi } from 'vitest'
import request from 'supertest'
import { createDb, migrate } from '../src/db/client'
import { events, payees } from '../src/db/schema'
import { createApp, finalize } from '../src/app'
import { verifyRouter } from '../src/routes/verify'
import { verifyService } from '../src/services/verify-service'

const ACME = '0xc1a53DA961B7A3A62db84Ae889f57fa818d3C426'
const LOOKALIKE = '0xC1A5d69D86Dea5CA36F7aE391b6610CfFB96C426' // same first and last 4 hex as ACME, unregistered
const UNREGISTERED = '0x9999999999999999999999999999999999999999'
const OLD = '0x5555555555555555555555555555555555555555'

function setup() {
  const db = createDb(':memory:'); migrate(db)
  const row = { lei: '', masterId: '0x00000000', level: 1, evidenceHash: '0x00', updatedBlock: 1 }
  db.insert(payees).values({ ...row, wallet: ACME, legalName: 'Acme Ltd', domain: 'acme.example', activeFrom: 1 }).run()
  db.insert(payees).values({ ...row, wallet: OLD, legalName: 'Old Co', domain: 'old.example', activeFrom: 1, revokedAt: 10 }).run()
  const ops = { resolveRecipient: vi.fn(async (to: any) => ({ effective: to, isVirtual: false, masterId: null, registered: true })), readPayee: vi.fn(async () => null), readAllowlist: vi.fn() }
  const deps = { db, chain: { network: 'testnet' } as any, config: { webOrigin: '*' } as any, ops } as any
  return { db, ops, deps }
}

describe('verifyService', () => {
  test('the wallet registered for the domain is a MATCH', async () => {
    const { deps } = setup()
    expect((await verifyService(deps, { address: ACME, domain: 'acme.example' })).verdict).toBe('MATCH')
  })
  test('a subdomain of the registered domain is the same service', async () => {
    const { deps } = setup()
    expect((await verifyService(deps, { address: ACME, domain: 'data.acme.example' })).verdict).toBe('MATCH')
  })
  test('a lookalike wallet named for the domain is LOOKALIKE and BLOCK', async () => {
    const { deps } = setup()
    expect(await verifyService(deps, { address: LOOKALIKE, domain: 'acme.example' })).toMatchObject({ verdict: 'LOOKALIKE', action: 'BLOCK' })
  })
  test('a verified wallet is not the wallet of an unregistered domain whose name happens to match', async () => {
    const { deps } = setup()
    // "acme-ltd.co" and "Acme Ltd" normalize to the same name, but nothing is registered for acme-ltd.co
    const r = await verifyService(deps, { address: ACME, domain: 'acme-ltd.co' })
    expect(r.verdict).not.toBe('MATCH')
    expect(r.action).not.toBe('PAY')
    expect(r.reasons.find((x) => x.code === 'domain_mismatch')?.detail).toBe("acme-ltd.co is not Acme Ltd's registered domain (acme.example)")
  })
  test('without a domain: is it an active Bound-verified wallet at all', async () => {
    const { deps } = setup()
    expect((await verifyService(deps, { address: ACME })).verdict).toBe('MATCH')
    expect((await verifyService(deps, { address: UNREGISTERED })).verdict).toBe('NO_MATCH')
  })
  test('a revoked payee is not matched by its domain or its wallet', async () => {
    const { deps } = setup()
    expect((await verifyService(deps, { address: OLD, domain: 'old.example' })).verdict).not.toBe('MATCH')
    expect((await verifyService(deps, { address: OLD })).verdict).not.toBe('MATCH')
  })
})

describe('POST /v1/verify-service', () => {
  test('validates the body and returns the verdict; public checks are not persisted', async () => {
    const { db, deps } = setup()
    const app = createApp(deps); app.use('/v1', verifyRouter(deps)); finalize(app)
    expect((await request(app).post('/v1/verify-service').send({ address: 'nope', domain: 'acme.example' })).status).toBe(400)
    expect((await request(app).post('/v1/verify-service').send({ address: ACME, domain: 'a'.repeat(300) })).status).toBe(400)
    // a domain that normalizes to nothing must not silently become "any verified wallet"
    expect((await request(app).post('/v1/verify-service').send({ address: ACME, domain: 'https://' })).status).toBe(400)
    const ok = await request(app).post('/v1/verify-service').send({ address: ACME.toLowerCase(), domain: 'acme.example' })
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({ verdict: 'MATCH', address: ACME })
    const look = await request(app).post('/v1/verify-service').send({ address: LOOKALIKE, domain: 'acme.example' })
    expect(look.body).toMatchObject({ verdict: 'LOOKALIKE', action: 'BLOCK' })
    expect(db.select().from(events).all()).toHaveLength(0)
  })
})
