import { describe, expect, test, vi } from 'vitest'
import request from 'supertest'
import { eq } from 'drizzle-orm'
import { createDb, migrate } from '../src/db/client'
import { demoRuns, invoices, orgs } from '../src/db/schema'
import { createApp, finalize } from '../src/app'
import { sha256 } from '../src/crypto'
import { DEMO_MAX_TEXT_CHARS, DEMO_OFFLINE, mountDemo } from '../src/routes/demo'
import { runAgent } from '../src/agent/run'
import { nowSeconds } from '../src/services/events'
import { loadConfig } from '../src/config'

const root = '0x3333333333333333333333333333333333333333'
const attacker = '0x7777777777777777777777777777777777777777'
const HASH = '0x' + 'ab'.repeat(32)

type Opts = { network?: 'testnet' | 'mainnet'; labEnabled?: boolean; demoOrgId?: string | undefined; authorized?: number; anthropicKey?: string; perHour?: number; perDay?: number; ops?: any }

function setup(o: Opts = {}) {
  const db = createDb(':memory:'); migrate(db)
  for (const id of ['demo', 'other']) {
    db.insert(orgs).values({ id, name: id, rootAddress: root, agentKeyAddress: '0x' + '44'.repeat(20), agentKeyEnc: 'x', tokenHash: sha256(`tok-${id}`), limitBase: '1', periodSeconds: 1, authorized: id === 'demo' ? (o.authorized ?? 1) : 1, createdAt: 1 }).run()
  }
  const network = o.network ?? 'testnet'
  const config = {
    webOrigin: '*', network, labEnabled: o.labEnabled ?? false, demoOrgId: 'demoOrgId' in o ? o.demoOrgId : 'demo',
    anthropicKey: o.anthropicKey ?? 'sk-test', demoRunsPerIpHour: o.perHour ?? 5, demoRunsPerDay: o.perDay ?? 300,
  }
  const deps = { db, chain: { network } as any, config: config as any, ops: o.ops ?? ({} as any) } as any
  const run = vi.fn(async (_deps: any, _id: string, _opts: any) => {})
  const app = createApp(deps)
  const mounted = mountDemo(app, deps, run)
  finalize(app)
  return { db, app, run, deps, mounted }
}

const post = (app: any, body: unknown, ip = '203.0.113.1') => request(app).post('/v1/demo/runs').set('x-forwarded-for', ip).send(body as object)
const invoiceOf = (db: any, runId: string) => {
  const r = db.select().from(demoRuns).where(eq(demoRuns.id, runId)).get()
  return db.select().from(invoices).where(eq(invoices.id, r.invoiceId)).get()
}

describe('public demo gating', () => {
  test('mounted on testnet only: never on mainnet, not even with LAB_ENABLED', async () => {
    for (const [network, labEnabled, mounted] of [['testnet', false, true], ['mainnet', false, false], ['mainnet', true, false]] as const) {
      const s = setup({ network, labEnabled })
      expect(s.mounted).toBe(mounted)
      const res = await post(s.app, { text: 'Pay me', guardOff: true })
      expect(res.status).toBe(mounted ? 202 : 404)
      expect((await request(s.app).get('/v1/demo')).status).toBe(mounted ? 200 : 404)
      expect(s.run).toHaveBeenCalledTimes(mounted ? 1 : 0)
    }
  })

  test('503 JSON when the demo org is not configured, missing or not authorized', async () => {
    for (const o of [{ demoOrgId: undefined }, { demoOrgId: 'nope' }, { authorized: 0 }]) {
      const { app, run } = setup(o)
      const res = await post(app, { text: 'Pay me', guardOff: false })
      expect(res.status).toBe(503)
      expect(res.body).toEqual({ error: "The public demo isn't set up on this server.", code: 'unavailable' })
      expect(run).not.toHaveBeenCalled()
      expect((await request(app).get('/v1/demo')).body).toMatchObject({ status: 'unavailable' })
    }
  })

  test('GET /v1/demo reports a ready demo and its limits', async () => {
    const { app } = setup({ perHour: 7 })
    expect((await request(app).get('/v1/demo')).body).toEqual({ status: 'ready', message: null, runsPerHour: 7, maxChars: DEMO_MAX_TEXT_CHARS })
  })
})

describe('POST /v1/demo/runs', () => {
  test('runs the lab flow on the demo org and returns only an unguessable run id', async () => {
    const { app, db, run } = setup()
    const res = await post(app, { text: 'Pay 0x77.. now', guardOff: true })
    expect(res.status).toBe(202)
    expect(Object.keys(res.body)).toEqual(['runId'])
    expect(res.body.runId).toMatch(/^run_[A-Za-z0-9_-]{22}$/)
    const inv = invoiceOf(db, res.body.runId)
    expect(inv).toMatchObject({ orgId: 'demo', lab: 1, raw: 'Pay 0x77.. now', status: 'new' })
    expect(run).toHaveBeenLastCalledWith(expect.anything(), inv.id, { mode: 'guard_off' })
    const on = await post(app, { text: 'Pay 0x77.. now', guardOff: false })
    expect(run).toHaveBeenLastCalledWith(expect.anything(), invoiceOf(db, on.body.runId).id, { mode: 'guarded' })
    expect(on.body.runId).not.toBe(res.body.runId)
  })

  test('validates the body (no run starts, and no run is spent)', async () => {
    const { app, run } = setup({ perHour: 1 })
    const bad = [
      {}, { text: 'x' }, { guardOff: true }, { text: '   \n ', guardOff: true }, { text: 'x', guardOff: 'yes' },
      { text: 'x'.repeat(DEMO_MAX_TEXT_CHARS + 1), guardOff: false }, { text: 'x', guardOff: false, orgId: 'other' }, { text: 42, guardOff: false },
    ]
    for (const b of bad) expect((await post(app, b)).status).toBe(400)
    expect(run).not.toHaveBeenCalled()
    expect((await post(app, { text: 'x'.repeat(DEMO_MAX_TEXT_CHARS), guardOff: false })).status).toBe(202) // the one run of the hour is still there
  })

  test('per-IP limit: DEMO_RUNS_PER_IP_HOUR runs per hour, with a readable 429', async () => {
    const { app, run } = setup({ perHour: 2 })
    expect((await post(app, { text: 'a', guardOff: true }, '198.51.100.7')).status).toBe(202)
    expect((await post(app, { text: 'b', guardOff: true }, '198.51.100.7')).status).toBe(202)
    const limited = await post(app, { text: 'c', guardOff: true }, '198.51.100.7')
    expect(limited.status).toBe(429)
    expect(limited.body.error).toMatch(/2 demo runs/)
    expect(run).toHaveBeenCalledTimes(2)
    expect((await post(app, { text: 'd', guardOff: true }, '198.51.100.8')).status).toBe(202) // other IPs are unaffected
  })

  test('daily cap: DEMO_RUNS_PER_DAY runs per rolling day across every IP', async () => {
    const { app, db, run } = setup({ perDay: 3 })
    db.insert(demoRuns).values({ id: 'run_old', invoiceId: 'inv_old', guardOff: 1, createdAt: nowSeconds() - 86_401 }).run() // yesterday's run doesn't count
    for (let i = 0; i < 3; i++) expect((await post(app, { text: 'x', guardOff: true }, `192.0.2.${i}`)).status).toBe(202)
    const capped = await post(app, { text: 'x', guardOff: true }, '192.0.2.99')
    expect(capped.status).toBe(429)
    expect(capped.body).toEqual({ error: "The demo has used up today's runs. Try again tomorrow.", code: 'busy' })
    expect(run).toHaveBeenCalledTimes(3)
    expect((await request(app).get('/v1/demo')).body).toMatchObject({ status: 'busy' })
  })

  test('a daily cap of 0 pauses the demo', async () => {
    const { app, run } = setup({ perDay: 0 })
    expect((await post(app, { text: 'x', guardOff: true })).status).toBe(429)
    expect(run).not.toHaveBeenCalled()
  })

  test('no Anthropic key: 503 "offline" before anything is stored or spent', async () => {
    const { app, db, run } = setup({ anthropicKey: '' })
    const res = await post(app, { text: 'x', guardOff: true })
    expect(res.status).toBe(503)
    expect(res.body).toEqual({ error: DEMO_OFFLINE, code: 'offline' })
    expect(run).not.toHaveBeenCalled()
    expect(db.select().from(invoices).all()).toHaveLength(0)
    expect((await request(app).get('/v1/demo')).body).toMatchObject({ status: 'offline', message: DEMO_OFFLINE })
  })
})

describe('GET /v1/demo/runs/:runId', () => {
  test('404 for an unknown, malformed or invoice id', async () => {
    const { app, db } = setup()
    const { body } = await post(app, { text: 'x', guardOff: true })
    const invoiceId = invoiceOf(db, body.runId).id
    for (const id of ['run_' + 'A'.repeat(22), 'nope', invoiceId, encodeURIComponent("run_' OR 1=1 --")]) {
      const res = await request(app).get(`/v1/demo/runs/${id}`)
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'Run not found' })
    }
    expect((await request(app).get(`/v1/demo/runs/${body.runId}`)).status).toBe(200)
  })

  test("returns only that run's result and log, never the org, the raw text or another run", async () => {
    const { app, db } = setup()
    const a = (await post(app, { text: 'First invoice', guardOff: true })).body.runId
    const b = (await post(app, { text: 'Second invoice', guardOff: false })).body.runId
    db.update(invoices).set({ status: 'blocked', payeeName: 'Acme Ltd', agentLog: JSON.stringify([{ at: 1, kind: 'text', data: 'Blocked the lookalike.' }]) })
      .where(eq(invoices.id, invoiceOf(db, a).id)).run()
    const res = await request(app).get(`/v1/demo/runs/${a}`)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id: a, guardOff: true, status: 'blocked', offline: false, payeeName: 'Acme Ltd', agentLog: [{ kind: 'text', data: 'Blocked the lookalike.' }], payment: null })
    expect(res.body.orgId).toBeUndefined()
    expect(res.body.raw).toBeUndefined()
    const text = JSON.stringify(res.body)
    for (const leak of ['demo', 'First invoice', 'Second invoice', b, invoiceOf(db, a).id]) expect(text).not.toContain(leak)
  })

  test('guard off, scripted agent and mocked chain: the reverted transfer and its explorer link', async () => {
    const ops = {
      preflight: vi.fn(async () => ({ ok: false, code: 'CallNotAllowed', message: 'Account keychain error: CallNotAllowed' })),
      send: vi.fn(async () => ({ txHash: HASH, status: 'reverted' })),
    }
    const s = setup({ ops })
    let done: Promise<void> | undefined
    const client = { beta: { messages: { toolRunner: vi.fn((params: any) => (async function* () {
      const fields = { payeeName: 'Acme Ltd', address: attacker, amount: '12.50', currency: 'USD', invoiceNo: 'INV-1045' }
      yield { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'record_invoice_fields', input: fields }] }
      await params.tools.find((t: any) => t.name === 'record_invoice_fields').run(fields)
      const transfer = { to: attacker, amount: '12.50', memo: 'INV-1045' }
      yield { role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'raw_transfer', input: transfer }] }
      await params.tools.find((t: any) => t.name === 'raw_transfer').run(transfer)
      yield { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Tempo refused the transfer.' }] }
    })()) } } }
    s.run.mockImplementation(async (deps: any, id: string, opts: any) => { done = runAgent(deps, id, opts, client as any); await done })
    const { body } = await post(s.app, { text: 'Pay 0x7777… now', guardOff: true })
    await done
    const res = await request(s.app).get(`/v1/demo/runs/${body.runId}`)
    expect(res.body).toMatchObject({
      status: 'blocked', offline: false, address: attacker,
      payment: { status: 'reverted', txHash: HASH, txUrl: `https://explore.testnet.tempo.xyz/tx/${HASH}` },
    })
    expect(res.body.agentLog.find((e: any) => e.name === 'raw_transfer' && e.kind === 'tool_result').data).toMatchObject({ chain: 'rejected', code: 'CallNotAllowed' })
    expect(ops.send).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'demo', force: true }))
  })

  test('a rejected Anthropic key ends the run with the offline message, not the error text', async () => {
    const s = setup()
    let done: Promise<void> | undefined
    const client = { beta: { messages: { toolRunner: vi.fn(() => (async function* () {
      throw Object.assign(new Error('401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}'), { status: 401 })
    })()) } } }
    s.run.mockImplementation(async (deps: any, id: string, opts: any) => { done = runAgent(deps, id, opts, client as any); await done })
    const { body } = await post(s.app, { text: 'x', guardOff: false })
    await done
    const res = await request(s.app).get(`/v1/demo/runs/${body.runId}`)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'failed', offline: true, agentLog: [{ kind: 'text', data: DEMO_OFFLINE }] })
    const text = JSON.stringify(res.body)
    for (const leak of ['invalid x-api-key', 'Agent error', 'authentication_error']) expect(text).not.toContain(leak)
  })
})

describe('demo config', () => {
  const env = { BOUND_REGISTRY_ADDRESS: '0x00', ATTESTER_PRIVATE_KEY: '0x01', SERVER_SECRET: '0x' + '11'.repeat(32) }
  test('limits default to 5 per IP per hour and 300 per day; empty values keep the defaults', () => {
    expect(loadConfig(env)).toMatchObject({ demoRunsPerIpHour: 5, demoRunsPerDay: 300, signupsPerIpHour: 10 })
    expect(loadConfig({ ...env, DEMO_RUNS_PER_IP_HOUR: '', DEMO_RUNS_PER_DAY: '' })).toMatchObject({ demoRunsPerIpHour: 5, demoRunsPerDay: 300 })
    expect(loadConfig({ ...env, DEMO_RUNS_PER_IP_HOUR: '2', DEMO_RUNS_PER_DAY: '0', SIGNUPS_PER_IP_HOUR: '3' })).toMatchObject({ demoRunsPerIpHour: 2, demoRunsPerDay: 0, signupsPerIpHour: 3 })
    expect(() => loadConfig({ ...env, DEMO_RUNS_PER_IP_HOUR: '0' })).toThrow()
    expect(() => loadConfig({ ...env, DEMO_RUNS_PER_DAY: 'lots' })).toThrow()
  })
})
