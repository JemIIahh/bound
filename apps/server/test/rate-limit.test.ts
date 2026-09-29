import { describe, expect, test, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createDb, migrate } from '../src/db/client'
import { orgs, payees } from '../src/db/schema'
import { createApp, finalize } from '../src/app'
import { sha256 } from '../src/crypto'
import { rateLimit } from '../src/rate-limit'
import { verifyRouter } from '../src/routes/verify'
import { invoicesRouter } from '../src/routes/invoices'
import { labRouter } from '../src/routes/lab'
import { mountMcp } from '../src/mcp'

const acme = '0xCcB7f43C7D6DBbC4e545d8C01761098da5332ED2'
const root = '0x3333333333333333333333333333333333333333'

function deps() {
  const db = createDb(':memory:'); migrate(db)
  db.insert(payees).values({ wallet: acme, legalName: 'Acme Ltd', domain: 'acme.com', lei: '', masterId: '0x00000000', level: 1, activeFrom: 1, evidenceHash: '0x00', updatedBlock: 1 }).run()
  for (const [id, tok] of [['org1', 'tok1'], ['org2', 'tok2']] as const) {
    db.insert(orgs).values({ id, name: id, rootAddress: root, agentKeyAddress: '0x' + '44'.repeat(20), agentKeyEnc: 'x', tokenHash: sha256(tok), limitBase: '1', periodSeconds: 1, authorized: 1, createdAt: 1 }).run()
  }
  const ops = { resolveRecipient: vi.fn(async (to: any) => ({ effective: to, isVirtual: false, masterId: null, registered: true })), readPayee: vi.fn(async () => null) }
  return { db, chain: { network: 'testnet' } as any, config: { webOrigin: '*', network: 'testnet' } as any, ops } as any
}

async function hammer(n: number, fire: () => Promise<request.Response>) {
  const statuses: number[] = []
  for (let i = 0; i < n; i++) statuses.push((await fire()).status)
  return statuses
}

describe('rateLimit (token bucket)', () => {
  test('allows `limit` requests per window per key, refills over time, answers 429 JSON', async () => {
    let now = 0
    const app = express()
    app.get('/x', rateLimit({ limit: 2, windowMs: 60_000, key: (req) => String(req.headers['x-key']), now: () => now }), (_req, res) => { res.json({ ok: true }) })
    const hit = (k: string) => request(app).get('/x').set('x-key', k)
    expect((await hit('a')).status).toBe(200)
    expect((await hit('a')).status).toBe(200)
    const limited = await hit('a')
    expect(limited.status).toBe(429)
    expect(limited.body).toEqual({ error: 'Too many requests' })
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0)
    expect((await hit('b')).status).toBe(200) // keys are independent
    now += 30_000 // half a window refills one token
    expect((await hit('a')).status).toBe(200)
    expect((await hit('a')).status).toBe(429)
  })
})

describe('limits on public and costly routes', () => {
  test('POST /v1/verify: 60 per minute per IP', async () => {
    const d = deps()
    const app = createApp(d); app.use('/v1', verifyRouter(d)); finalize(app)
    const statuses = await hammer(61, () => request(app).post('/v1/verify').send({ address: acme, payeeName: 'Acme Ltd' }))
    expect(statuses.slice(0, 60).every((s) => s === 200)).toBe(true)
    expect(statuses[60]).toBe(429)
  })

  test('POST /mcp: 60 per minute per IP', async () => {
    const d = deps()
    const app = createApp(d); mountMcp(app, d); finalize(app)
    const statuses = await hammer(61, () => request(app).post('/mcp').set('accept', 'application/json, text/event-stream').send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }))
    expect(statuses.slice(0, 60).every((s) => s === 200)).toBe(true)
    expect(statuses[60]).toBe(429)
  })

  test('invoice submission: 10 per minute per org', async () => {
    const d = deps()
    const run = vi.fn(async () => {})
    const app = createApp(d); app.use('/v1', invoicesRouter(d, run)); finalize(app)
    const post = (org: string, tok: string) => request(app).post(`/v1/orgs/${org}/invoices`).set('authorization', `Bearer ${tok}`).send({ text: 'Invoice' })
    const statuses = await hammer(11, () => post('org1', 'tok1'))
    expect(statuses.slice(0, 10).every((s) => s === 202)).toBe(true)
    expect(statuses[10]).toBe(429)
    expect(run).toHaveBeenCalledTimes(10)
    expect((await post('org2', 'tok2')).status).toBe(202) // other orgs are unaffected
    // unauthenticated requests are refused before they can spend an org's budget
    expect((await request(app).post('/v1/orgs/org2/invoices').send({ text: 'x' })).status).toBe(401)
  })

  test('lab runs: 10 per minute per org', async () => {
    const d = deps()
    const run = vi.fn(async () => {})
    const app = createApp(d); app.use('/v1', labRouter(d, run)); finalize(app)
    const statuses = await hammer(11, () => request(app).post('/v1/lab/org1/run').set('authorization', 'Bearer tok1').send({ text: 'x', guardOff: true }))
    expect(statuses.slice(0, 10).every((s) => s === 202)).toBe(true)
    expect(statuses[10]).toBe(429)
  })
})
