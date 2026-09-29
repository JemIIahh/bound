import { describe, expect, test, vi } from 'vitest'
import request from 'supertest'
import { decodeFunctionData, getAddress } from 'viem'
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts'
import { Abis } from 'viem/tempo'
import { eq } from 'drizzle-orm'
import { AllowlistError, KEYCHAIN } from '@bound/core'
import { createDb, migrate } from '../src/db/client'
import { approvals, invoices, orgs } from '../src/db/schema'
import { createApp, finalize } from '../src/app'
import { orgsRouter } from '../src/routes/orgs'
import { decryptSecret, sha256 } from '../src/crypto'

const root = '0x3333333333333333333333333333333333333333'
const token = '0x20c0000000000000000000000000000000000000'
const secret = ('0x' + '42'.repeat(32)) as `0x${string}`
const TX = '0x' + 'ab'.repeat(32)
const future = BigInt(Math.floor(Date.now() / 1000) + 86400 * 90)

function setup(config: Record<string, unknown> = {}) {
  const db = createDb(':memory:'); migrate(db)
  const ops = {
    waitReceipt: vi.fn(async () => ({ status: 'success' as const })),
    readKey: vi.fn(async () => ({ expiry: future, enforceLimits: true, isRevoked: false })),
    readAllowlist: vi.fn(async (): Promise<any> => [root]),
    remainingLimit: vi.fn(async () => 250_000_000n),
    sendDemoRoot: vi.fn(async () => TX as `0x${string}`),
  }
  const deps = { db, chain: { network: 'testnet', token } as any, config: { webOrigin: '*', serverSecret: secret, ...config } as any, ops } as any
  const app = createApp(deps); app.use('/v1', orgsRouter(deps)); finalize(app)
  return { db, ops, app }
}

async function create(app: any, rootAddress = root) {
  return request(app).post('/v1/orgs').send({ name: 'Buyer Inc', rootAddress, limitUsd: '250', periodSeconds: 604800 })
}

describe('POST /v1/orgs', () => {
  test('creates an org with an encrypted scoped agent key and an authorizeKey call allowlisting only the root', async () => {
    const { app, db } = setup()
    const res = await create(app)
    expect(res.status).toBe(201)
    const { org, token: apiToken, authorizeCall } = res.body
    expect(org).toMatchObject({ name: 'Buyer Inc', rootAddress: root })
    expect(Object.keys(org).sort()).toEqual(['agentKeyAddress', 'id', 'name', 'rootAddress'])
    const row = db.select().from(orgs).where(eq(orgs.id, org.id)).get()!
    expect(row.tokenHash).toBe(sha256(apiToken))
    expect(row.limitBase).toBe('250000000')
    expect(row.authorized).toBe(0)
    expect(row.agentKeyEnc).not.toMatch(/^0x/)
    expect(privateKeyToAddress(decryptSecret(row.agentKeyEnc, secret) as `0x${string}`)).toBe(org.agentKeyAddress)
    expect(authorizeCall.to).toBe(KEYCHAIN)
    const d = decodeFunctionData({ abi: Abis.accountKeychain, data: authorizeCall.data })
    expect(d.functionName).toBe('authorizeKey')
    const [keyId, , cfg] = d.args as any
    expect(keyId).toBe(org.agentKeyAddress)
    expect(cfg.allowAnyCalls).toBe(false)
    expect(cfg.limits[0]).toMatchObject({ token: getAddress(token), amount: 250_000_000n, period: 604800n })
    expect(cfg.allowedCalls[0].selectorRules[0].recipients).toEqual([root])
    const days = Number(cfg.expiry - BigInt(Math.floor(Date.now() / 1000))) / 86400
    expect(days).toBeGreaterThan(179.9)
    expect(days).toBeLessThan(180.1)
  })
  test('validates input', async () => {
    const { app } = setup()
    expect((await create(app, 'nope')).status).toBe(400)
    expect((await request(app).post('/v1/orgs').send({ name: 'x', rootAddress: root, limitUsd: 'lots', periodSeconds: 60 })).status).toBe(400)
    expect((await request(app).post('/v1/orgs').send({ name: 'x', rootAddress: root, limitUsd: '0', periodSeconds: 60 })).status).toBe(400)
    expect((await request(app).post('/v1/orgs').send({ name: 'x', rootAddress: root, limitUsd: '10', periodSeconds: 0 })).status).toBe(400)
    expect((await request(app).post('/v1/orgs').send({ name: 'x', rootAddress: '0x0000000000000000000000000000000000000000', limitUsd: '10', periodSeconds: 60 })).status).toBe(400)
  })
})

describe('requireOrg + overview', () => {
  test('401 without, with a wrong, or with another org\'s token', async () => {
    const { app } = setup()
    const o1 = (await create(app)).body
    const o2 = (await create(app)).body
    expect((await request(app).get(`/v1/orgs/${o1.org.id}/overview`)).status).toBe(401)
    expect((await request(app).get(`/v1/orgs/${o1.org.id}/overview`).set('authorization', 'Bearer wrong')).status).toBe(401)
    expect((await request(app).get(`/v1/orgs/${o1.org.id}/overview`).set('authorization', `Bearer ${o2.token}`)).status).toBe(401)
    expect((await request(app).get(`/v1/orgs/nope/overview`).set('authorization', `Bearer ${o1.token}`)).status).toBe(401)
    expect((await request(app).get(`/v1/orgs/${o1.org.id}/overview`).set('authorization', `Bearer ${o1.token}`)).status).toBe(200)
  })
  test('overview shape, no secrets, counters', async () => {
    const { app, db, ops } = setup()
    const { org, token: t } = (await create(app)).body
    db.update(orgs).set({ authorized: 1 }).where(eq(orgs.id, org.id)).run()
    db.insert(invoices).values({ id: 'i1', orgId: org.id, raw: 'secret invoice text', amountBase: '7000000', status: 'blocked', verdictJson: JSON.stringify({ verdict: 'LOOKALIKE' }), createdAt: 2 }).run()
    db.insert(approvals).values({ id: 'ap1', orgId: org.id, invoiceId: 'i1', wallet: root, label: 'x', verdictJson: JSON.stringify({ verdict: 'NO_MATCH' }), createdAt: 2 }).run()
    const res = await request(app).get(`/v1/orgs/${org.id}/overview`).set('authorization', `Bearer ${t}`)
    expect(res.status).toBe(200)
    const body = res.body
    expect(body.org).toMatchObject({ id: org.id, rootAddress: root, authorized: true })
    expect(JSON.stringify(body)).not.toContain('agentKeyEnc')
    expect(JSON.stringify(body)).not.toContain('tokenHash')
    expect(JSON.stringify(body)).not.toContain('secret invoice text')
    expect(body.allowlist).toEqual([root])
    expect(body.capacity).toEqual({ used: 1, max: 57 })
    expect(body.remaining).toBe('250000000')
    expect(body.invoices[0].verdict).toEqual({ verdict: 'LOOKALIKE' })
    expect(body.approvals[0].verdict).toEqual({ verdict: 'NO_MATCH' })
    expect(body.counters).toEqual({ checks: 0, paid: 0, blocked: 1, protectedBase: '7000000' })
    for (const k of ['pins', 'payments', 'events']) expect(Array.isArray(body[k])).toBe(true)
    expect(ops.readAllowlist).toHaveBeenCalled()
  })
  test('overview reports an unrestricted key instead of an allowlist', async () => {
    const { app, db, ops } = setup()
    const { org, token: t } = (await create(app)).body
    db.update(orgs).set({ authorized: 1 }).where(eq(orgs.id, org.id)).run()
    ops.readAllowlist.mockRejectedValueOnce(new AllowlistError('unrestricted: empty recipient list'))
    const res = await request(app).get(`/v1/orgs/${org.id}/overview`).set('authorization', `Bearer ${t}`)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ allowlist: [], keyStatus: 'unrestricted' })
  })
})

describe('authorization', () => {
  test('POST /authorized checks the key is live, limited and scoped', async () => {
    const { app, db, ops } = setup()
    const { org, token: t } = (await create(app)).body
    const res = await request(app).post(`/v1/orgs/${org.id}/authorized`).set('authorization', `Bearer ${t}`).send({ txHash: TX })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ authorized: true })
    expect(ops.waitReceipt).toHaveBeenCalledWith(TX)
    expect(ops.readKey).toHaveBeenCalledWith(root, org.agentKeyAddress)
    expect(db.select().from(orgs).where(eq(orgs.id, org.id)).get()).toMatchObject({ authorized: 1, authorizeTx: TX })
  })
  test('refuses a revoked, expired, unlimited or unrestricted key', async () => {
    const { app, db, ops } = setup()
    const { org, token: t } = (await create(app)).body
    const post = () => request(app).post(`/v1/orgs/${org.id}/authorized`).set('authorization', `Bearer ${t}`).send({ txHash: TX })
    ops.readKey.mockResolvedValueOnce({ expiry: future, enforceLimits: true, isRevoked: true })
    expect((await post()).status).toBe(409)
    ops.readKey.mockResolvedValueOnce({ expiry: 0n, enforceLimits: false, isRevoked: false })
    expect((await post()).status).toBe(409)
    ops.readKey.mockResolvedValueOnce({ expiry: future, enforceLimits: false, isRevoked: false })
    expect((await post()).status).toBe(409)
    ops.readAllowlist.mockRejectedValueOnce(new AllowlistError('unrestricted: key has no call scopes (any call allowed).'))
    expect((await post()).status).toBe(409)
    ops.waitReceipt.mockResolvedValueOnce({ status: 'reverted' } as any)
    expect((await post()).status).toBe(409)
    expect((await request(app).post(`/v1/orgs/${org.id}/authorized`).set('authorization', `Bearer ${t}`).send({ txHash: 'nope' })).status).toBe(400)
    expect(db.select().from(orgs).where(eq(orgs.id, org.id)).get()?.authorized).toBe(0)
  })
  test('authorize-demo only works when the demo root key controls the org root', async () => {
    const demoKey = generatePrivateKey()
    const demoRoot = privateKeyToAddress(demoKey)
    const { app, ops } = setup({ demoRootKey: demoKey })
    const other = (await create(app)).body
    expect((await request(app).post(`/v1/orgs/${other.org.id}/authorize-demo`).set('authorization', `Bearer ${other.token}`)).status).toBe(403)
    expect(ops.sendDemoRoot).not.toHaveBeenCalled()
    const mine = (await create(app, demoRoot)).body
    const res = await request(app).post(`/v1/orgs/${mine.org.id}/authorize-demo`).set('authorization', `Bearer ${mine.token}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ authorized: true })
    const call = (ops.sendDemoRoot.mock.calls[0] as any)[0]
    const d = decodeFunctionData({ abi: Abis.accountKeychain, data: call.data })
    expect(d.functionName).toBe('authorizeKey')
    expect((d.args as any)[2].allowedCalls[0].selectorRules[0].recipients).toEqual([demoRoot])
  })
  test('authorize-demo is 404 when no demo key is configured', async () => {
    const { app } = setup()
    const { org, token: t } = (await create(app)).body
    expect((await request(app).post(`/v1/orgs/${org.id}/authorize-demo`).set('authorization', `Bearer ${t}`)).status).toBe(404)
  })
})

describe('approval routes', () => {
  test('prepare refuses a LOOKALIKE approval with 409 over HTTP', async () => {
    const { app, db } = setup()
    const { org, token: t } = (await create(app)).body
    db.insert(approvals).values({ id: 'ap1', orgId: org.id, invoiceId: 'i1', wallet: '0x5555555555555555555555555555555555555555', label: 'x', verdictJson: JSON.stringify({ verdict: 'LOOKALIKE' }), createdAt: 2 }).run()
    const res = await request(app).post(`/v1/orgs/${org.id}/approvals/ap1/prepare`).set('authorization', `Bearer ${t}`)
    expect(res.status).toBe(409)
  })
  test('prepare returns the setAllowedCalls call and recipients', async () => {
    const { app, db } = setup()
    const { org, token: t } = (await create(app)).body
    const w = '0x5555555555555555555555555555555555555555'
    db.insert(approvals).values({ id: 'ap1', orgId: org.id, invoiceId: 'i1', wallet: w, label: 'x', verdictJson: JSON.stringify({ verdict: 'NO_MATCH' }), createdAt: 2 }).run()
    const res = await request(app).post(`/v1/orgs/${org.id}/approvals/ap1/prepare`).set('authorization', `Bearer ${t}`)
    expect(res.status).toBe(200)
    expect(res.body.recipients).toEqual([root, w])
    expect(res.body.call.to).toBe(KEYCHAIN)
  })
})
