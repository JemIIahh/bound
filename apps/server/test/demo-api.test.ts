import { afterEach, describe, expect, test, vi } from 'vitest'
import request from 'supertest'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { getAddress } from 'viem'
import { generatePrivateKey } from 'viem/accounts'
import { Receipt } from 'mppx'
import { createDb, migrate } from '../src/db/client'
import { demoApiRuns, orgs, payees } from '../src/db/schema'
import { createApp, finalize } from '../src/app'
import { encryptSecret, sha256 } from '../src/crypto'
import { deriveMppSecret, loadConfig } from '../src/config'
import { DEMO_API_DATA, mountDemoApi, serviceWording, type DemoApiInject } from '../src/routes/demo-api'
import { nowSeconds } from '../src/services/events'

// The public testnet demo deployment (README): Acme Ltd's verified wallet and the lab lookalike (same first and last 4 hex chars).
const ACME = '0xc1a53DA961B7A3A62db84Ae889f57fa818d3C426'
const LOOKALIKE = '0xC1A5d69D86Dea5CA36F7aE391b6610CfFB96C426'
const ROOT = '0x06dc65C749734F95534BA0102aA629974e8F7943'
const PATHUSD = '0x20c0000000000000000000000000000000000000'
const SECRET = ('0x' + '11'.repeat(32)) as `0x${string}`
const RECEIPT_TX = '0x' + 'cd'.repeat(32)
const EVIDENCE_TX = '0x' + 'ab'.repeat(32)
const AGENT_KEY = generatePrivateKey()

type Opts = {
  network?: 'testnet' | 'mainnet'; labEnabled?: boolean; publicOrgId?: string | undefined; authorized?: number
  perHour?: number; perDay?: number; ops?: Record<string, unknown>; inject?: DemoApiInject; payee?: string | undefined
}

function setup(o: Opts = {}) {
  const db = createDb(':memory:'); migrate(db)
  // 'filmed' is the seeded demo org (DEMO_ORG_ID); 'public' is the one the public demo may use (DEMO_PUBLIC_ORG_ID)
  for (const id of ['filmed', 'public']) {
    db.insert(orgs).values({
      id, name: id, rootAddress: ROOT, agentKeyAddress: '0x' + '44'.repeat(20), agentKeyEnc: encryptSecret(AGENT_KEY, SECRET), tokenHash: sha256(`tok-${id}`),
      limitBase: '50000000', periodSeconds: 86_400, authorized: id === 'public' ? (o.authorized ?? 1) : 1, createdAt: 1,
    }).run()
  }
  db.insert(payees).values({ wallet: ACME, legalName: 'Acme Ltd', domain: 'acme.example', lei: '', masterId: '0x00000000', level: 1, activeFrom: 1, evidenceHash: '0x00', updatedBlock: 1 }).run()
  const network = o.network ?? 'testnet'
  const config = {
    webOrigin: '*', network, labEnabled: o.labEnabled ?? false, port: 8787, serverSecret: SECRET, mppSecretKey: deriveMppSecret(SECRET),
    demoOrgId: 'filmed', demoPublicOrgId: 'publicOrgId' in o ? o.publicOrgId : 'public',
    demoRunsPerIpHour: o.perHour ?? 6, demoApiRunsPerDay: o.perDay ?? 200,
    demoPayeeAddress: 'payee' in o ? o.payee : ACME, labLookalikeAddress: LOOKALIKE,
  }
  const ops = {
    resolveRecipient: vi.fn(async (to: string) => ({ effective: to, isVirtual: false, masterId: null, registered: false })),
    readPayee: vi.fn(async () => null),
    ...o.ops,
  }
  const deps = { db, chain: { network, token: PATHUSD } as any, config: config as any, ops } as any
  const app = createApp(deps)
  const mounted = mountDemoApi(app, deps, o.inject)
  finalize(app)
  return { db, app, deps, ops, mounted }
}

/** A CallNotAllowed refusal shaped like the one the spike recorded (viem TransactionExecutionError, no tx hash). */
function callNotAllowed() {
  const cause = Object.assign(new Error('execution reverted'), { name: 'ExecutionRevertedError', details: 'Account keychain error: CallNotAllowed(CallNotAllowed)' })
  return Object.assign(new Error('Execution reverted with reason: Account keychain error: CallNotAllowed(CallNotAllowed).'), {
    name: 'TransactionExecutionError', shortMessage: 'Execution reverted with reason: Account keychain error: CallNotAllowed(CallNotAllowed).', cause,
  })
}

/**
 * A fake mppx client for the paid API: answers 402 naming Acme (or the lookalike for ?hijack=1) and 200 with a receipt once a
 * credential is attached. `pay` stands in for signing (createCredential), so no key, chain or network is touched.
 */
function fakeClient(pay: () => Promise<string>) {
  const requests: { url: string; paid: boolean }[] = []
  const client = {
    rawFetch: vi.fn(async (url: string, init: RequestInit = {}) => {
      const paid = /^Payment /.test(new Headers(init.headers).get('authorization') ?? '')
      requests.push({ url, paid })
      if (!paid) return new Response(null, { status: 402 })
      const receipt = Receipt.serialize(Receipt.from({ method: 'tempo', reference: RECEIPT_TX, status: 'success', timestamp: new Date().toISOString() }))
      return new Response(JSON.stringify({ data: DEMO_API_DATA }), { status: 200, headers: { 'content-type': 'application/json', 'payment-receipt': receipt } })
    }),
    preparePayment: vi.fn(async () => ({
      challenge: {
        method: 'tempo', intent: 'charge',
        request: { amount: '10000', currency: PATHUSD, methodDetails: { chainId: 42431 }, recipient: requests.at(-1)!.url.includes('hijack=1') ? LOOKALIKE : ACME },
      },
      createCredential: pay,
      setCredential: (init: RequestInit, credential: string) => ({ ...init, headers: { authorization: `Payment ${credential}` } }),
    })),
  }
  return { client, requests, factory: vi.fn(() => client) }
}

const run = (app: any, body: unknown, ip = '203.0.113.1') => request(app).post('/v1/demo/api-runs').set('x-forwarded-for', ip).send(body as object)
const kinds = (steps: { kind: string }[]) => steps.map((s) => s.kind)
const rows = (db: any) => db.select().from(demoApiRuns).all()

describe('demo paid API gating', () => {
  test('mounted on testnet only: never on mainnet, not even with LAB_ENABLED', async () => {
    for (const [network, labEnabled, mounted] of [['testnet', false, true], ['mainnet', false, false], ['mainnet', true, false]] as const) {
      const { pay, factory } = (() => { const pay = vi.fn(async () => 'cred'); return { pay, ...fakeClient(pay) } })()
      const s = setup({ network, labEnabled, inject: { paymentClient: factory } })
      expect(s.mounted).toBe(mounted)
      expect((await request(s.app).get('/v1/demo/api/data')).status).toBe(mounted ? 402 : 404)
      expect((await request(s.app).get('/v1/demo/api-runs/status')).status).toBe(mounted ? 200 : 404)
      expect((await run(s.app, { hijacked: false, guardOff: false })).status).toBe(mounted ? 200 : 404)
      expect(pay).toHaveBeenCalledTimes(mounted ? 1 : 0)
    }
  })

  test('the paid API answers 402 with an MPP challenge for 0.01 pathUSD to Acme, or to the lookalike with ?hijack=1', async () => {
    const { app } = setup()
    for (const [path, recipient] of [['/v1/demo/api/data', ACME], ['/v1/demo/api/data?hijack=1', LOOKALIKE], ['/v1/demo/api/data?hijack=yes', ACME]] as const) {
      const res = await request(app).get(path)
      expect(res.status).toBe(402)
      const wire = /request="([^"]+)"/.exec(res.headers['www-authenticate'] ?? '')?.[1]
      expect(JSON.parse(Buffer.from(wire!, 'base64url').toString('utf8'))).toEqual({ amount: '10000', currency: PATHUSD, methodDetails: { chainId: 42431 }, recipient })
    }
  })

  test('the paid API answers 503 when its wallets are not configured', async () => {
    const { app } = setup({ payee: undefined })
    expect((await request(app).get('/v1/demo/api/data')).status).toBe(503)
  })
})

describe('GET /v1/demo/api-runs/status', () => {
  test('unavailable when the public demo org is unset, unknown, not authorized or the filmed org', async () => {
    for (const o of [{ publicOrgId: undefined }, { publicOrgId: 'nope' }, { authorized: 0 }, { publicOrgId: 'filmed' }, { payee: undefined }]) {
      const { app } = setup(o)
      expect((await request(app).get('/v1/demo/api-runs/status')).body).toEqual({ status: 'unavailable', message: "The public demo isn't set up on this server.", runsPerHour: 6 })
    }
  })

  test('ready with the per-IP limit, busy at the daily cap (yesterday does not count), and a cap of 0 pauses it', async () => {
    const { app, db } = setup({ perHour: 7, perDay: 2 })
    expect((await request(app).get('/v1/demo/api-runs/status')).body).toEqual({ status: 'ready', message: null, runsPerHour: 7 })
    db.insert(demoApiRuns).values({ id: 'dar_old', hijacked: 0, guardOff: 0, outcome: 'paid', txHash: null, createdAt: nowSeconds() - 86_401 }).run()
    db.insert(demoApiRuns).values({ id: 'dar_1', hijacked: 0, guardOff: 0, outcome: 'paid', txHash: null, createdAt: nowSeconds() }).run()
    expect((await request(app).get('/v1/demo/api-runs/status')).body.status).toBe('ready')
    db.insert(demoApiRuns).values({ id: 'dar_2', hijacked: 1, guardOff: 0, outcome: 'blocked_by_bound', txHash: null, createdAt: nowSeconds() }).run()
    expect((await request(app).get('/v1/demo/api-runs/status')).body).toEqual({ status: 'busy', message: "The paid-API demo has used up today's runs. Try again tomorrow.", runsPerHour: 7 })
    expect((await request(setup({ perDay: 0 }).app).get('/v1/demo/api-runs/status')).body.status).toBe('busy')
  })
})

describe('POST /v1/demo/api-runs', () => {
  test('honest API, guard on: Bound verifies Acme for acme.example, the agent signs, the API returns the data', async () => {
    const pay = vi.fn(async () => 'cred')
    const f = fakeClient(pay)
    const sendEvidence = vi.fn(async () => EVIDENCE_TX as `0x${string}`)
    const { app, db } = setup({ inject: { paymentClient: f.factory, sendEvidence } })
    const res = await run(app, { hijacked: false, guardOff: false })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ outcome: 'paid', recipient: ACME, txHash: RECEIPT_TX, txUrl: `https://explore.testnet.tempo.xyz/tx/${RECEIPT_TX}` })
    expect(Object.keys(res.body).sort()).toEqual(['message', 'outcome', 'recipient', 'steps', 'txHash', 'txUrl'])
    expect(kinds(res.body.steps)).toEqual(['request', 'challenge', 'check', 'decision', 'sign', 'result'])
    const [req, challenge, check, decision, , result] = res.body.steps
    expect(req.data).toEqual({ method: 'GET', path: '/v1/demo/api/data', service: 'acme.example' })
    expect(challenge.data).toMatchObject({ amount: '0.01', amountBase: '10000', currency: 'pathUSD', recipient: ACME, chainId: 42431, splits: 0 })
    expect(check.data).toMatchObject({ address: ACME, role: 'primary', verdict: 'MATCH', payee: { legalName: 'Acme Ltd', domain: 'acme.example' } })
    expect(decision.data).toMatchObject({ allow: true })
    expect(result.data).toMatchObject({ status: 200, data: DEMO_API_DATA, txHash: RECEIPT_TX })
    for (const s of res.body.steps) expect(typeof s.text).toBe('string')
    expect(pay).toHaveBeenCalledTimes(1)
    expect(f.factory).toHaveBeenCalledWith('public') // the public demo org, never the filmed one
    expect(f.requests).toEqual([{ url: 'http://127.0.0.1:8787/v1/demo/api/data', paid: false }, { url: 'http://127.0.0.1:8787/v1/demo/api/data', paid: true }])
    expect(sendEvidence).not.toHaveBeenCalled()
    expect(rows(db)).toEqual([expect.objectContaining({ hijacked: 0, guardOff: 0, outcome: 'paid', txHash: RECEIPT_TX })])
  })

  test('hijacked API, guard on: blocked before signing, no second request, nothing sent', async () => {
    const pay = vi.fn(async () => 'cred')
    const f = fakeClient(pay)
    const sendEvidence = vi.fn(async () => EVIDENCE_TX as `0x${string}`)
    const { app, db } = setup({ inject: { paymentClient: f.factory, sendEvidence } })
    const res = await run(app, { hijacked: true, guardOff: false })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ outcome: 'blocked_by_bound', recipient: LOOKALIKE, txHash: null, txUrl: null })
    expect(kinds(res.body.steps)).toEqual(['request', 'challenge', 'check', 'decision', 'result'])
    expect(res.body.steps[2].data).toMatchObject({ address: LOOKALIKE, verdict: 'LOOKALIKE' })
    expect(res.body.steps[3].data).toMatchObject({ allow: false })
    expect(res.body.message).toMatch(/Bound/)
    expect(pay).not.toHaveBeenCalled()
    expect(f.requests).toHaveLength(1)
    expect(sendEvidence).not.toHaveBeenCalled()
    expect(rows(db)).toEqual([expect.objectContaining({ hijacked: 1, guardOff: 0, outcome: 'blocked_by_bound', txHash: null })])
  })

  test('hijacked API, guard on: the lookalike verdict reads as a payment request, never as an invoice', async () => {
    const pay = vi.fn(async () => 'cred')
    const f = fakeClient(pay)
    const { app } = setup({ inject: { paymentClient: f.factory } })
    const res = await run(app, { hijacked: true, guardOff: false })
    expect(res.body.outcome).toBe('blocked_by_bound')
    const check = res.body.steps.find((s: { kind: string }) => s.kind === 'check')
    // the same findings as an invoice check (core's wording is untouched), reworded for the page
    expect(check.data.reasons.map((r: { code: string }) => r.code)).toEqual(expect.arrayContaining(['lookalike_address', 'claims_verified_payee']))
    expect(check.data.reasons.find((r: { code: string }) => r.code === 'claims_verified_payee').detail)
      .toBe(`The payment request is for Acme Ltd (verified wallet ${ACME}) but pays an unverified address`)
    for (const s of res.body.steps) {
      expect(s.text).not.toMatch(/invoice/i)
      expect(JSON.stringify(s.data ?? null)).not.toMatch(/invoice/i)
    }
    expect(res.body.message).not.toMatch(/invoice/i)
    expect(pay).not.toHaveBeenCalled()
  })

  test('serviceWording rewords every invoice-worded reason detail for a payment request', () => {
    expect(serviceWording(`Invoice claims to be Acme Ltd (verified wallet ${ACME}) but pays an unverified address`))
      .toBe(`The payment request is for Acme Ltd (verified wallet ${ACME}) but pays an unverified address`)
    expect(serviceWording('Invoice name uses look-alike characters')).toBe('The name uses look-alike characters')
    expect(serviceWording('Invoice sent from acme.example, which belongs to Acme Ltd')).toBe('acme.example belongs to Acme Ltd')
    expect(serviceWording('Invoice sent from data.acme.example; registered domain is acme.example')).toBe('data.acme.example is not the registered domain (acme.example)')
    expect(serviceWording('No verified company is registered for this address')).toBe('No verified company is registered for this address')
    expect(serviceWording('an unforeseen invoice rule')).not.toMatch(/invoice/i)
  })

  test("guard on, Bound's check fails: blocked before signing, and the error text stays off the page", async () => {
    const pay = vi.fn(async () => 'cred')
    const f = fakeClient(pay)
    const resolveRecipient = vi.fn(async () => { throw new Error('rpc down at https://rpc.internal/?key=secret') })
    const { app } = setup({ inject: { paymentClient: f.factory }, ops: { resolveRecipient } })
    const res = await run(app, { hijacked: false, guardOff: false })
    expect(res.body.outcome).toBe('blocked_by_bound')
    expect(res.body.steps.find((s: { kind: string }) => s.kind === 'decision').data).toEqual({ allow: false, reason: `could not verify recipient ${ACME}` })
    expect(JSON.stringify(res.body)).not.toMatch(/rpc|secret/)
    expect(pay).not.toHaveBeenCalled()
  })

  test('hijacked API, guard off: the payment is attempted, Tempo refuses it (CallNotAllowed), and the evidence tx is linked', async () => {
    const pay = vi.fn(async (): Promise<string> => { throw callNotAllowed() })
    const f = fakeClient(pay)
    const sendEvidence = vi.fn(async () => EVIDENCE_TX as `0x${string}`)
    const { app, db } = setup({ inject: { paymentClient: f.factory, sendEvidence } })
    const res = await run(app, { hijacked: true, guardOff: true })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ outcome: 'blocked_by_tempo', recipient: LOOKALIKE, txHash: EVIDENCE_TX, txUrl: `https://explore.testnet.tempo.xyz/tx/${EVIDENCE_TX}` })
    expect(res.body.message).toMatch(/Tempo/)
    expect(kinds(res.body.steps)).toEqual(['request', 'challenge', 'decision', 'sign', 'result'])
    expect(res.body.steps[2].data).toEqual({ guard: 'off' })
    expect(res.body.steps[4].data).toMatchObject({ code: 'CallNotAllowed', txHash: EVIDENCE_TX })
    expect(pay).toHaveBeenCalledTimes(1)
    expect(sendEvidence).toHaveBeenCalledWith({ orgId: 'public', to: LOOKALIKE, amount: 10_000n })
    expect(rows(db)).toEqual([expect.objectContaining({ hijacked: 1, guardOff: 1, outcome: 'blocked_by_tempo', txHash: EVIDENCE_TX })])
  })

  test('guard off: without an evidence tx (none, or it failed) the run still reports Tempo blocked it, with no link', async () => {
    for (const sendEvidence of [vi.fn(async () => null), vi.fn(async () => { throw new Error('rpc down') })]) {
      const f = fakeClient(async () => { throw callNotAllowed() })
      const { app } = setup({ inject: { paymentClient: f.factory, sendEvidence } })
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const res = await run(app, { hijacked: true, guardOff: true })
      spy.mockRestore()
      expect(res.body).toMatchObject({ outcome: 'blocked_by_tempo', txHash: null, txUrl: null })
      expect(JSON.stringify(res.body)).not.toContain('rpc down')
    }
  })

  test('honest API, guard off: nothing checks the recipient; this API happens to be honest, so it pays', async () => {
    const pay = vi.fn(async () => 'cred')
    const f = fakeClient(pay)
    const { app } = setup({ inject: { paymentClient: f.factory } })
    const res = await run(app, { hijacked: false, guardOff: true })
    expect(res.body).toMatchObject({ outcome: 'paid', recipient: ACME, txHash: RECEIPT_TX })
    expect(kinds(res.body.steps)).toEqual(['request', 'challenge', 'decision', 'sign', 'result'])
  })

  test('default evidence: force-sent only when the preflight says Tempo will refuse it (CallNotAllowed), testnet only', async () => {
    const ops = {
      preflight: vi.fn(async () => ({ ok: false, code: 'CallNotAllowed', message: 'Account keychain error: CallNotAllowed' })),
      send: vi.fn(async () => ({ txHash: EVIDENCE_TX, status: 'reverted' })),
    }
    const f = fakeClient(async () => { throw callNotAllowed() })
    const { app } = setup({ ops, inject: { paymentClient: f.factory } })
    const res = await run(app, { hijacked: true, guardOff: true })
    expect(res.body).toMatchObject({ outcome: 'blocked_by_tempo', txHash: EVIDENCE_TX })
    expect(ops.send).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'public', to: LOOKALIKE, amount: 10_000n, force: true }))

    // a payment Tempo would (or might) accept is never force-sent
    for (const preflight of [vi.fn(async () => ({ ok: true })), vi.fn(async () => ({ ok: false, code: 'SpendingLimitExceeded', message: '' })), vi.fn(async () => { throw new Error('rpc') })]) {
      const send = vi.fn(async () => ({ txHash: EVIDENCE_TX, status: 'reverted' }))
      const s = setup({ ops: { preflight, send }, inject: { paymentClient: fakeClient(async () => { throw callNotAllowed() }).factory } })
      expect((await run(s.app, { hijacked: true, guardOff: true })).body).toMatchObject({ outcome: 'blocked_by_tempo', txHash: null })
      expect(send).not.toHaveBeenCalled()
    }
  })

  test('validates the body (nothing runs and no run is spent)', async () => {
    const pay = vi.fn(async () => 'cred')
    const f = fakeClient(pay)
    const { app, db } = setup({ perHour: 1, inject: { paymentClient: f.factory } })
    for (const b of [{}, { hijacked: true }, { guardOff: false }, { hijacked: 'yes', guardOff: false }, { hijacked: 1, guardOff: 0 }, { hijacked: false, guardOff: false, orgId: 'filmed' }]) {
      const res = await run(app, b)
      expect(res.status).toBe(400)
    }
    expect(f.factory).not.toHaveBeenCalled()
    expect(rows(db)).toHaveLength(0)
    expect((await run(app, { hijacked: false, guardOff: false })).status).toBe(200) // the one run of the hour is still there
  })

  test('per-IP limit: DEMO_RUNS_PER_IP_HOUR runs per hour, then 429; other IPs are unaffected', async () => {
    const f = fakeClient(async () => 'cred')
    const { app } = setup({ perHour: 2, inject: { paymentClient: f.factory } })
    expect((await run(app, { hijacked: true, guardOff: false }, '198.51.100.7')).status).toBe(200)
    expect((await run(app, { hijacked: true, guardOff: false }, '198.51.100.7')).status).toBe(200)
    const limited = await run(app, { hijacked: true, guardOff: false }, '198.51.100.7')
    expect(limited.status).toBe(429)
    expect(limited.body.error).toMatch(/2 demo runs/)
    expect((await run(app, { hijacked: true, guardOff: false }, '198.51.100.8')).status).toBe(200)
  })

  test('daily cap: DEMO_API_RUNS_PER_DAY runs per rolling day for everyone, then 429 busy; 503 when not set up', async () => {
    const f = fakeClient(async () => 'cred')
    const { app, db } = setup({ perDay: 2, inject: { paymentClient: f.factory } })
    for (let i = 0; i < 2; i++) expect((await run(app, { hijacked: true, guardOff: false }, `192.0.2.${i}`)).status).toBe(200)
    const capped = await run(app, { hijacked: true, guardOff: false }, '192.0.2.99')
    expect(capped.status).toBe(429)
    expect(capped.body).toEqual({ error: "The paid-API demo has used up today's runs. Try again tomorrow.", code: 'busy' })
    expect(rows(db)).toHaveLength(2)
    const off = setup({ publicOrgId: undefined, inject: { paymentClient: f.factory } })
    expect((await run(off.app, { hijacked: true, guardOff: false })).body).toEqual({ error: "The public demo isn't set up on this server.", code: 'unavailable' })
    expect((await run(off.app, { hijacked: true, guardOff: false })).status).toBe(503)
  })

  test('an unexpected error ends the run as failed with a generic message (no error text, no stack) and is still recorded', async () => {
    const secret = 'boom https://rpc.example/key-abc123 0xdeadbeef'
    const broken = [
      vi.fn(() => { throw new Error(secret) }), // building the payment client (e.g. the key cannot be decrypted)
      vi.fn(() => ({ rawFetch: async () => { throw new Error(secret) }, preparePayment: async () => { throw new Error(secret) } })),
      fakeClient(async () => { throw new Error(secret) }).factory, // signing fails for a reason other than Tempo's refusal
    ]
    for (const paymentClient of broken) {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { app, db } = setup({ inject: { paymentClient: paymentClient as any } })
      const res = await run(app, { hijacked: false, guardOff: true })
      spy.mockRestore()
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ outcome: 'failed', txHash: null, txUrl: null, message: 'The demo run could not finish. Try again in a minute.' })
      const text = JSON.stringify(res.body)
      for (const leak of ['boom', 'rpc.example', 'deadbeef', 'stack', AGENT_KEY.slice(2)]) expect(text).not.toContain(leak)
      expect(rows(db)).toEqual([expect.objectContaining({ outcome: 'failed' })])
    }
  })
})

describe('with the real mppx client and the real demo API (no chain)', () => {
  let server: Server | undefined
  afterEach(() => { server?.close(); server = undefined })

  test("hijacked, guard on: the org's own mppx client gets a real 402, Bound blocks it, and no credential ever reaches the API", async () => {
    const seen: { url: string; credential: boolean }[] = []
    const fetchImpl = vi.fn(async (input: any, init?: RequestInit) => {
      seen.push({ url: String(input), credential: /^Payment /.test(new Headers(init?.headers).get('authorization') ?? '') })
      return fetch(input, init)
    }) as unknown as typeof fetch
    const s = setup({ inject: { fetchImpl } })
    server = s.app.listen(0)
    await new Promise((r) => server!.once('listening', r))
    s.deps.config.port = (server!.address() as AddressInfo).port
    const res = await run(s.app, { hijacked: true, guardOff: false })
    expect(res.body).toMatchObject({ outcome: 'blocked_by_bound', recipient: LOOKALIKE, txHash: null })
    expect(kinds(res.body.steps)).toEqual(['request', 'challenge', 'check', 'decision', 'result'])
    expect(res.body.steps[1].data).toMatchObject({ method: 'tempo', intent: 'charge', amount: '0.01', amountBase: '10000', currency: 'pathUSD', recipient: LOOKALIKE, chainId: 42431 })
    expect(seen).toEqual([{ url: `http://127.0.0.1:${s.deps.config.port}/v1/demo/api/data?hijack=1`, credential: false }])
    const text = JSON.stringify(res.body)
    for (const leak of [AGENT_KEY.slice(2), SECRET.slice(2), 'public']) expect(text).not.toContain(leak)
  })
})

describe('MPP secret', () => {
  test('MPP_SECRET_KEY is optional: derived from SERVER_SECRET (stable, 32 bytes), or taken as set when at least 32 bytes', () => {
    const base = { BOUND_REGISTRY_ADDRESS: '0x' + '00'.repeat(20), ATTESTER_PRIVATE_KEY: '0x' + '01'.repeat(32), SERVER_SECRET: SECRET }
    const derived = loadConfig(base as any).mppSecretKey
    expect(derived).toMatch(/^0x[0-9a-f]{64}$/)
    expect(derived).not.toBe(SECRET)
    expect(loadConfig(base as any).mppSecretKey).toBe(derived)
    expect(loadConfig({ ...base, MPP_SECRET_KEY: 'k'.repeat(32) } as any).mppSecretKey).toBe('k'.repeat(32))
    expect(() => loadConfig({ ...base, MPP_SECRET_KEY: 'short' } as any)).toThrow()
  })

  test('the demo wallets come from env, default to the public testnet deployment, and are never defaulted on mainnet', () => {
    const base = { BOUND_REGISTRY_ADDRESS: '0x' + '00'.repeat(20), ATTESTER_PRIVATE_KEY: '0x' + '01'.repeat(32), SERVER_SECRET: SECRET }
    expect(loadConfig(base as any)).toMatchObject({ demoPayeeAddress: ACME, labLookalikeAddress: LOOKALIKE, demoApiRunsPerDay: 200 })
    expect(loadConfig({ ...base, DEMO_PAYEE_ADDRESS: '0x' + '9a'.repeat(20) } as any).demoPayeeAddress).toBe(getAddress('0x' + '9a'.repeat(20)))
    expect(loadConfig({ ...base, TEMPO_NETWORK: 'mainnet' } as any)).toMatchObject({ demoPayeeAddress: undefined, labLookalikeAddress: undefined })
    expect(() => loadConfig({ ...base, LAB_LOOKALIKE_ADDRESS: 'nope' } as any)).toThrow()
  })
})

