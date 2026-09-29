import { afterEach, describe, expect, test, vi } from 'vitest'
import request from 'supertest'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { keccak256, stringToHex, zeroAddress, type Address, type Hex } from 'viem'
import { eq } from 'drizzle-orm'
import { createDb, migrate } from '../src/db/client'
import { createApp, finalize, HttpError } from '../src/app'
import { payees, payeeVerifications } from '../src/db/schema'
import { payeesRouter } from '../src/routes/payees'
import { productionPayeeServices } from '../src/services/payee-verification'
import { SerialJobQueue } from '../src/services/mining-queue'
import { resolveTxt } from '../src/services/dns'

type Mined = { salt: Hex; masterId: Hex }
const MINED: Mined = { salt: ('0x' + '00'.repeat(28) + 'abf52baf') as Hex, masterId: '0x83196cf2' }

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const flush = () => new Promise((r) => setTimeout(r, 0))

function setup(over: Partial<Parameters<typeof payeesRouter>[1]> = {}, db = (() => { const d = createDb(':memory:'); migrate(d); return d })()) {
  const deps = { db, chain: { network: 'testnet' } as any, config: { webOrigin: '*', registry: '0x' + '99'.repeat(20) } as any }
  const mocks = {
    resolveTxt: vi.fn(async (_name: string) => [] as string[]),
    lookupLei: vi.fn(async () => null as any),
    writeAttestation: vi.fn(async () => ({ txHash: '0xabc' as `0x${string}`, action: 'attest' as const })),
    mineSalt: vi.fn(async (_wallet: Address): Promise<Mined> => MINED),
    checkMaster: vi.fn(async () => true),
  }
  // Overrides are vi.fn mocks too; keep the mock types so tests can call mockResolvedValueOnce.
  const services = { ...mocks, ...over } as typeof mocks
  const app = createApp(deps)
  // Each test router gets its own queue so a test's pending miner cannot block another test.
  app.use('/v1', payeesRouter(deps, services, new SerialJobQueue()))
  finalize(app)
  return { app, db, services }
}

const rowOf = (db: ReturnType<typeof createDb>, id: string) => db.select().from(payeeVerifications).where(eq(payeeVerifications.id, id)).get()!

describe('payee verification flow', () => {
  test('happy path: create → sign → dns → lei → attest at level 2', async () => {
    const pk = generatePrivateKey(); const acct = privateKeyToAccount(pk)
    const { app, services } = setup({
      lookupLei: vi.fn(async () => ({ legalName: 'ACME LIMITED', status: 'ISSUED' })),
    })
    const created = await request(app).post('/v1/payee-verifications').send({ wallet: acct.address, legalName: 'Acme Ltd', domain: 'Acme.com', lei: '5493001KJTIIGC8Y1R12' })
    expect(created.status).toBe(201)
    expect(created.body.dns.name).toBe('_bound.acme.com')
    const sig = await acct.signTypedData(created.body.typedData)
    const s = await request(app).post(`/v1/payee-verifications/${created.body.id}/signature`).send({ signature: sig })
    expect(s.body.sigVerified).toBe(true)
    // Persistent (not Once): /attest re-checks that the DNS proof is still published.
    services.resolveTxt.mockResolvedValue([created.body.dns.value])
    const d = await request(app).post(`/v1/payee-verifications/${created.body.id}/check-dns`)
    expect(d.body.dnsVerified).toBe(true)
    const l = await request(app).post(`/v1/payee-verifications/${created.body.id}/check-lei`)
    expect(l.body.leiVerified).toBe(true)
    const a = await request(app).post(`/v1/payee-verifications/${created.body.id}/attest`)
    expect(a.status).toBe(200)
    expect(a.body.level).toBe(2)
    expect(services.writeAttestation).toHaveBeenCalledOnce()
  })

  test('signature from another wallet is rejected', async () => {
    const other = privateKeyToAccount(generatePrivateKey())
    const { app } = setup()
    const created = await request(app).post('/v1/payee-verifications').send({ wallet: '0x' + '11'.repeat(20), legalName: 'Acme Ltd', domain: 'acme.com' })
    const sig = await other.signTypedData(created.body.typedData)
    const s = await request(app).post(`/v1/payee-verifications/${created.body.id}/signature`).send({ signature: sig })
    expect(s.body.sigVerified).toBe(false)
  })

  test('attest requires signature and DNS', async () => {
    const { app } = setup()
    const created = await request(app).post('/v1/payee-verifications').send({ wallet: '0x' + '11'.repeat(20), legalName: 'Acme Ltd', domain: 'acme.com' })
    const a = await request(app).post(`/v1/payee-verifications/${created.body.id}/attest`)
    expect(a.status).toBe(409)
  })

  test('LEI whose legal name does not match is not verified', async () => {
    const { app } = setup({ lookupLei: vi.fn(async () => ({ legalName: 'GLOBEX CORPORATION', status: 'ISSUED' })) })
    const created = await request(app).post('/v1/payee-verifications').send({ wallet: '0x' + '11'.repeat(20), legalName: 'Acme Ltd', domain: 'acme.com', lei: '5493001KJTIIGC8Y1R12' })
    const l = await request(app).post(`/v1/payee-verifications/${created.body.id}/check-lei`)
    expect(l.body.leiVerified).toBe(false)
  })

  test('rejects invalid input', async () => {
    const { app } = setup()
    const r = await request(app).post('/v1/payee-verifications').send({ wallet: 'nope', legalName: '', domain: 'x' })
    expect(r.status).toBe(400)
  })
})

/** Creates a verification whose signature and DNS proof are verified. The DNS record stays published. */
async function signedAndDnsVerified(app: any, services: any, domain = 'acme.com') {
  const acct = privateKeyToAccount(generatePrivateKey())
  const created = await request(app).post('/v1/payee-verifications').send({ wallet: acct.address, legalName: 'Acme Ltd', domain })
  const sig = await acct.signTypedData(created.body.typedData)
  await request(app).post(`/v1/payee-verifications/${created.body.id}/signature`).send({ signature: sig })
  services.resolveTxt.mockResolvedValue([created.body.dns.value])
  await request(app).post(`/v1/payee-verifications/${created.body.id}/check-dns`)
  return { id: created.body.id as string, acct, typedData: created.body.typedData, dns: created.body.dns }
}

describe('payee verification details', () => {
  test('DNS check fails when the TXT value does not carry this nonce', async () => {
    const { app, services } = setup({ resolveTxt: vi.fn(async () => ['bound-verify=someone-else', 'v=spf1 -all']) })
    const created = await request(app).post('/v1/payee-verifications').send({ wallet: '0x' + '11'.repeat(20), legalName: 'Acme Ltd', domain: 'https://www.Acme.com/pay' })
    expect(created.body.dns).toEqual({ name: '_bound.acme.com', type: 'TXT', value: expect.stringMatching(/^bound-verify=/) })
    const d = await request(app).post(`/v1/payee-verifications/${created.body.id}/check-dns`)
    expect(d.body).toEqual({ dnsVerified: false, found: ['bound-verify=someone-else', 'v=spf1 -all'] })
    expect(services.resolveTxt).toHaveBeenCalledWith('_bound.acme.com')
  })

  test('LEI must be ISSUED; check-lei needs an LEI on the verification', async () => {
    const { app } = setup({ lookupLei: vi.fn(async () => ({ legalName: 'ACME LIMITED', status: 'LAPSED' })) })
    const withLei = await request(app).post('/v1/payee-verifications').send({ wallet: '0x' + '11'.repeat(20), legalName: 'Acme Ltd', domain: 'acme.com', lei: '5493001kjtiigc8y1r12' })
    expect(withLei.status).toBe(201)
    const l = await request(app).post(`/v1/payee-verifications/${withLei.body.id}/check-lei`)
    expect(l.body).toEqual({ leiVerified: false, legalName: 'ACME LIMITED', status: 'LAPSED' })
    const noLei = await request(app).post('/v1/payee-verifications').send({ wallet: '0x' + '11'.repeat(20), legalName: 'Acme Ltd', domain: 'acme.com' })
    expect((await request(app).post(`/v1/payee-verifications/${noLei.body.id}/check-lei`)).status).toBe(409)
  })

  test('attest without LEI is level 1 and records the tx; a second attest is refused', async () => {
    const { app, db, services } = setup()
    const { id } = await signedAndDnsVerified(app, services)
    const a = await request(app).post(`/v1/payee-verifications/${id}/attest`)
    expect(a.status).toBe(200)
    expect(a.body).toEqual({ txHash: '0xabc', level: 1, action: 'attest' })
    expect(services.writeAttestation).toHaveBeenCalledWith(expect.objectContaining({ id, domain: 'acme.com' }), 1)
    const row = rowOf(db, id)
    expect(row.status).toBe('attested')
    expect(row.attestTx).toBe('0xabc')
    expect((await request(app).post(`/v1/payee-verifications/${id}/attest`)).status).toBe(409)
  })

  test('a domain conflict from the attester surfaces as 409', async () => {
    const { app, services } = setup({ writeAttestation: vi.fn(async () => { throw new HttpError(409, 'Domain already verified by another wallet') }) })
    const { id } = await signedAndDnsVerified(app, services)
    const a = await request(app).post(`/v1/payee-verifications/${id}/attest`)
    expect(a.status).toBe(409)
    expect(a.body.error).toBe('Domain already verified by another wallet')
  })

  test('unknown verification id is 404', async () => {
    const { app } = setup()
    expect((await request(app).get('/v1/payee-verifications/pv_nope')).status).toBe(404)
    expect((await request(app).post('/v1/payee-verifications/pv_nope/attest')).status).toBe(404)
  })

  test('payee directory: search and lookup by wallet', async () => {
    const { app, db } = setup()
    const acme = '0xCcB7f43C7D6DBbC4e545d8C01761098da5332ED2'
    db.insert(payees).values({ wallet: acme, legalName: 'Acme Ltd', domain: 'acme.com', lei: '', masterId: '0x00000000', level: 1, activeFrom: 1, evidenceHash: '0x00', updatedBlock: 1 }).run()
    db.insert(payees).values({ wallet: '0x' + '22'.repeat(20), legalName: 'Globex 100% Corp', domain: 'globex.io', lei: '', masterId: '0x00000000', level: 1, activeFrom: 1, evidenceHash: '0x00', updatedBlock: 2 }).run()
    const byName = await request(app).get('/v1/payees').query({ q: 'acme' })
    expect(byName.body.payees.map((p: any) => p.wallet)).toEqual([acme])
    const byDomain = await request(app).get('/v1/payees').query({ q: 'globex.io' })
    expect(byDomain.body.payees).toHaveLength(1)
    const wildcard = await request(app).get('/v1/payees').query({ q: '%' })
    expect(wildcard.body.payees.map((p: any) => p.legalName)).toEqual(['Globex 100% Corp'])
    const one = await request(app).get(`/v1/payees/${acme.toLowerCase()}`)
    expect(one.status).toBe(200)
    expect(one.body.legalName).toBe('Acme Ltd')
    expect((await request(app).get('/v1/payees/0x' + '33'.repeat(20))).status).toBe(404)
    expect((await request(app).get('/v1/payees/not-an-address')).status).toBe(400)
  })
})

describe('fix round 1', () => {
  // 1. The attested domain is exactly the domain that was signed and proven in DNS.
  test('www.www.<domain> is stored as its fixed point; the attested domain equals the signed/DNS-proven one', async () => {
    const readContract = vi.fn(async ({ functionName }: any) => {
      if (functionName === 'currentWalletForDomain') return zeroAddress
      if (functionName === 'getPayee') return emptyPayee
      throw new Error('unexpected read ' + functionName)
    })
    const writeContractSync = vi.fn(async () => ({ status: 'success', transactionHash: '0xfeed' }))
    const db = createDb(':memory:'); migrate(db)
    const deps = { db, chain: { pub: { readContract }, attester: { writeContractSync } } as any, config: { webOrigin: '*', registry: '0x' + '99'.repeat(20) } as any }
    const resolveTxtMock = vi.fn(async (_name: string) => [] as string[])
    const app = createApp(deps)
    app.use('/v1', payeesRouter(deps, { ...productionPayeeServices(deps), resolveTxt: resolveTxtMock }, new SerialJobQueue()))
    finalize(app)

    const { id, typedData, dns } = await signedAndDnsVerified(app, { resolveTxt: resolveTxtMock }, 'www.www.acme.com')
    expect(typedData.message.domain).toBe('acme.com')
    expect(dns.name).toBe('_bound.acme.com')
    expect(resolveTxtMock).toHaveBeenCalledWith('_bound.acme.com')
    const a = await request(app).post(`/v1/payee-verifications/${id}/attest`)
    expect(a.status).toBe(200)
    const call = (writeContractSync.mock.calls[0] as any)[0]
    expect(call.args[2]).toBe(typedData.message.domain)
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'currentWalletForDomain', args: [keccak256(stringToHex(typedData.message.domain))] }))
  })

  test('writeAttestation refuses a stored domain that is not its own normal form', async () => {
    const h = harness({})
    await expect(h.services.writeAttestation({ ...h.row, domain: 'www.acme.com' }, 1)).rejects.toThrow(/normal/)
    await expect(h.services.writeAttestation({ ...h.row, domain: 'Acme.com' }, 1)).rejects.toThrow(/normal/)
    expect(h.writeContractSync).not.toHaveBeenCalled()
  })

  // 2. Stale DNS proof.
  test('attest re-checks DNS: 409 when the proof was removed, no tx', async () => {
    const { app, db, services } = setup()
    const { id } = await signedAndDnsVerified(app, services)
    services.resolveTxt.mockResolvedValue(['bound-verify=old-nonce'])
    const a = await request(app).post(`/v1/payee-verifications/${id}/attest`)
    expect(a.status).toBe(409)
    expect(a.body.error).toBe('DNS proof no longer present')
    expect(services.writeAttestation).not.toHaveBeenCalled()
    expect(rowOf(db, id).dnsVerified).toBe(0)
  })

  test('attest re-checks DNS: proceeds when the exact proof is still published', async () => {
    const { app, services } = setup()
    const { id, dns } = await signedAndDnsVerified(app, services)
    services.resolveTxt.mockClear()
    const a = await request(app).post(`/v1/payee-verifications/${id}/attest`)
    expect(a.status).toBe(200)
    expect(services.resolveTxt).toHaveBeenCalledWith(dns.name)
    expect(services.writeAttestation).toHaveBeenCalledOnce()
  })

  // 3 + 4. Mining: gated, serialized, restartable.
  test('mine-master requires signature AND DNS proof', async () => {
    const { app, services } = setup()
    const acct = privateKeyToAccount(generatePrivateKey())
    const created = await request(app).post('/v1/payee-verifications').send({ wallet: acct.address, legalName: 'Acme Ltd', domain: 'acme.com' })
    expect((await request(app).post(`/v1/payee-verifications/${created.body.id}/mine-master`)).status).toBe(409)
    const sig = await acct.signTypedData(created.body.typedData)
    await request(app).post(`/v1/payee-verifications/${created.body.id}/signature`).send({ signature: sig })
    expect((await request(app).post(`/v1/payee-verifications/${created.body.id}/mine-master`)).status).toBe(409)
    expect(services.mineSalt).not.toHaveBeenCalled()
  })

  test('mining: one job at a time, FIFO; queued rows read "mining"; then register', async () => {
    const jobs = [deferred<Mined>(), deferred<Mined>()]
    const { app, db, services } = setup()
    services.mineSalt.mockReturnValueOnce(jobs[0]!.promise).mockReturnValueOnce(jobs[1]!.promise)
    const A = await signedAndDnsVerified(app, services)
    const B = await signedAndDnsVerified(app, services)
    expect((await request(app).post(`/v1/payee-verifications/${A.id}/master`).send({ txHash: '0x' + 'ab'.repeat(32) })).status).toBe(409)

    const ma = await request(app).post(`/v1/payee-verifications/${A.id}/mine-master`)
    expect(ma.status).toBe(202)
    expect(ma.body).toEqual({ masterStatus: 'mining' })
    const mb = await request(app).post(`/v1/payee-verifications/${B.id}/mine-master`)
    expect(mb.status).toBe(202)
    expect(services.mineSalt).toHaveBeenCalledTimes(1) // B queued, not started in parallel
    expect(services.mineSalt).toHaveBeenLastCalledWith(A.acct.address)
    expect((await request(app).get(`/v1/payee-verifications/${B.id}`)).body.masterStatus).toBe('mining')
    // Re-posting an active/queued job does not start another one.
    expect((await request(app).post(`/v1/payee-verifications/${A.id}/mine-master`)).status).toBe(202)
    expect((await request(app).post(`/v1/payee-verifications/${B.id}/mine-master`)).status).toBe(202)
    expect(services.mineSalt).toHaveBeenCalledTimes(1)

    jobs[0]!.resolve(MINED); await flush()
    expect(services.mineSalt).toHaveBeenCalledTimes(2)
    expect(services.mineSalt).toHaveBeenLastCalledWith(B.acct.address)
    const ga = await request(app).get(`/v1/payee-verifications/${A.id}`)
    expect(ga.body).toMatchObject({ id: A.id, masterStatus: 'mined', masterId: MINED.masterId, salt: MINED.salt, sigVerified: true, dnsVerified: true })
    jobs[1]!.resolve(MINED); await flush()
    expect(rowOf(db, B.id).masterStatus).toBe('mined')

    const txHash = '0x' + 'ab'.repeat(32)
    expect((await request(app).post(`/v1/payee-verifications/${A.id}/master`).send({ txHash })).body).toEqual({ masterStatus: 'registered' })
    expect(services.checkMaster).toHaveBeenCalledWith(MINED.masterId, A.acct.address, txHash)
    services.checkMaster.mockResolvedValueOnce(false)
    expect((await request(app).post(`/v1/payee-verifications/${B.id}/master`).send({ txHash })).body).toEqual({ masterStatus: 'failed' })
  })

  test('routers built without a queue share the process-wide queue', async () => {
    const jobs = [deferred<Mined>(), deferred<Mined>()]
    const mineSalt = vi.fn(async (_w: Address) => MINED).mockReturnValueOnce(jobs[0]!.promise).mockReturnValueOnce(jobs[1]!.promise)
    const build = () => {
      const db = createDb(':memory:'); migrate(db)
      const deps = { db, chain: { network: 'testnet' } as any, config: { webOrigin: '*', registry: '0x' + '99'.repeat(20) } as any }
      const services = { resolveTxt: vi.fn(async (_n: string) => [] as string[]), lookupLei: vi.fn(), writeAttestation: vi.fn(), mineSalt, checkMaster: vi.fn() }
      const app = createApp(deps); app.use('/v1', payeesRouter(deps, services as any)); finalize(app)
      return { app, services }
    }
    const one = build(); const two = build()
    const A = await signedAndDnsVerified(one.app, one.services)
    const B = await signedAndDnsVerified(two.app, two.services)
    await request(one.app).post(`/v1/payee-verifications/${A.id}/mine-master`)
    await request(two.app).post(`/v1/payee-verifications/${B.id}/mine-master`)
    expect(mineSalt).toHaveBeenCalledTimes(1)
    jobs[0]!.resolve(MINED); await flush()
    expect(mineSalt).toHaveBeenCalledTimes(2)
    jobs[1]!.resolve(MINED); await flush() // drain the shared queue
  })

  test('a row left in "mining" by a previous process is restarted by a fresh router', async () => {
    const db = createDb(':memory:'); migrate(db)
    const wallet = '0xCcB7f43C7D6DBbC4e545d8C01761098da5332ED2'
    db.insert(payeeVerifications).values({ id: 'pv_stuck', wallet, legalName: 'Acme Ltd', domain: 'acme.com', nonce: 'n', sigVerified: 1, dnsVerified: 1, masterStatus: 'mining', createdAt: 1 }).run()
    const { app, services } = setup({}, db)
    const m = await request(app).post('/v1/payee-verifications/pv_stuck/mine-master')
    expect(m.status).toBe(202)
    expect(services.mineSalt).toHaveBeenCalledWith(wallet)
    await flush()
    expect(rowOf(db, 'pv_stuck')).toMatchObject({ masterStatus: 'mined', masterId: MINED.masterId })
  })

  test('a failed mining job marks the row failed and the queue moves on', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { app, db, services } = setup()
    services.mineSalt.mockRejectedValueOnce(new Error('exhausted'))
    const A = await signedAndDnsVerified(app, services)
    const B = await signedAndDnsVerified(app, services)
    await request(app).post(`/v1/payee-verifications/${A.id}/mine-master`)
    await request(app).post(`/v1/payee-verifications/${B.id}/mine-master`)
    await flush()
    expect(rowOf(db, A.id).masterStatus).toBe('failed')
    expect(rowOf(db, B.id).masterStatus).toBe('mined')
    // A failed job can be retried.
    expect((await request(app).post(`/v1/payee-verifications/${A.id}/mine-master`)).status).toBe(202)
    await flush()
    expect(rowOf(db, A.id).masterStatus).toBe('mined')
    errSpy.mockRestore()
  })

  test('mining failure whose DB write also throws does not escape as an unhandled rejection', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const job = deferred<Mined>()
    const { app, db, services } = setup()
    services.mineSalt.mockReturnValueOnce(job.promise)
    const A = await signedAndDnsVerified(app, services)
    await request(app).post(`/v1/payee-verifications/${A.id}/mine-master`)
    ;(db as any).$client.close() // every later DB write throws
    job.reject(new Error('exhausted'))
    await flush()
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  // 5. Legal name hygiene.
  test.each([
    ['zero-width space (Cf)', 'Acme​Ltd'],
    ['right-to-left override (Cf)', 'Acme ‮Ltd'],
    ['control character (Cc)', 'Acme\u0007 Ltd'],
    ['newline inside (Cc)', 'Acme\nLtd'],
    ['mixed-script homoglyph', 'Аcme Ltd'],
  ])('rejects a legal name with %s', async (_label, legalName) => {
    const { app } = setup()
    const r = await request(app).post('/v1/payee-verifications').send({ wallet: '0x' + '11'.repeat(20), legalName, domain: 'acme.com' })
    expect(r.status).toBe(400)
  })

  test.each(['Société Générale', 'Газпром', '株式会社トヨタ', 'AT&T Inc'])('accepts the legal name %s', async (legalName) => {
    const { app } = setup()
    const r = await request(app).post('/v1/payee-verifications').send({ wallet: '0x' + '11'.repeat(20), legalName, domain: 'acme.com' })
    expect(r.status).toBe(201)
  })

  // 6. Minor hardening.
  test('once attested, the proof and master endpoints are closed (409)', async () => {
    const { app, db, services } = setup()
    const { id } = await signedAndDnsVerified(app, services)
    db.update(payeeVerifications).set({ masterId: MINED.masterId, masterStatus: 'mined' }).where(eq(payeeVerifications.id, id)).run()
    expect((await request(app).post(`/v1/payee-verifications/${id}/attest`)).status).toBe(200)
    expect((await request(app).post(`/v1/payee-verifications/${id}/signature`).send({ signature: '0x1234' })).status).toBe(409)
    expect((await request(app).post(`/v1/payee-verifications/${id}/check-dns`)).status).toBe(409)
    expect((await request(app).post(`/v1/payee-verifications/${id}/check-lei`)).status).toBe(409)
    expect((await request(app).post(`/v1/payee-verifications/${id}/mine-master`)).status).toBe(409)
    expect((await request(app).post(`/v1/payee-verifications/${id}/master`).send({ txHash: '0x' + 'ab'.repeat(32) })).status).toBe(409)
    expect(services.checkMaster).not.toHaveBeenCalled()
    expect((await request(app).get(`/v1/payee-verifications/${id}`)).status).toBe(200)
  })

  describe('resolveTxt', () => {
    afterEach(() => { vi.unstubAllGlobals() })
    test('keeps only TXT answers (type 16) and joins quoted chunks', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
        Answer: [
          { name: '_bound.acme.com', type: 5, data: 'bound-verify=from-cname-target.' },
          { name: '_bound.acme.com', type: 16, data: '"bound-verify=abc"' },
          { name: '_bound.acme.com', type: 16, data: '"part-one" "part-two"' },
        ],
      }), { status: 200 })))
      expect(await resolveTxt('_bound.acme.com')).toEqual(['bound-verify=abc', 'part-onepart-two'])
    })
  })
})

const emptyPayee = { legalName: '', domain: '', lei: '', masterId: '0x00000000', level: 0, verifiedAt: 0n, activeFrom: 0n, supersededAt: 0n, revokedAt: 0n, successor: zeroAddress, evidenceHash: '0x' + '00'.repeat(32) }
const livePayee = (domain: string, over: Record<string, unknown> = {}) => ({ ...emptyPayee, legalName: 'X', domain, level: 1, verifiedAt: 100n, activeFrom: 100n, ...over })
const registry = ('0x' + '99'.repeat(20)) as Address
const wallet = '0xCcB7f43C7D6DBbC4e545d8C01761098da5332ED2' as Address
const other = '0x2222222222222222222222222222222222222222' as Address

function harness(state: { holder?: Address; payees?: Record<string, any>; status?: 'success' | 'reverted' }) {
  const readContract = vi.fn(async ({ functionName, args }: any) => {
    if (functionName === 'currentWalletForDomain') return state.holder ?? zeroAddress
    if (functionName === 'getPayee') return state.payees?.[(args[0] as string).toLowerCase()] ?? emptyPayee
    throw new Error('unexpected read ' + functionName)
  })
  const writeContractSync = vi.fn(async () => ({ status: state.status ?? 'success', transactionHash: '0xfeed' }))
  const db = createDb(':memory:'); migrate(db)
  const services = productionPayeeServices({ db, chain: { pub: { readContract }, attester: { writeContractSync } } as any, config: { registry } as any })
  const row = { id: 'pv_1', wallet, legalName: 'Acme Ltd', domain: 'acme.com', lei: '5493001KJTIIGC8Y1R12', nonce: 'n', signature: '0x1', sigVerified: 1, dnsVerified: 1, leiVerified: 0, leiRecordJson: null, salt: '0x01', masterId: '0x83196cf2', masterStatus: 'mined', attestTx: null, status: 'pending', createdAt: 1 }
  return { services, readContract, writeContractSync, row }
}

describe('productionPayeeServices.writeAttestation (BoundRegistry guards)', () => {
  test('unheld domain → attest, hashing the lowercased domain; unverified LEI and unregistered master are not written', async () => {
    const h = harness({})
    const out = await h.services.writeAttestation(h.row, 1)
    expect(out).toEqual({ txHash: '0xfeed', action: 'attest' })
    expect(h.readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'currentWalletForDomain', args: [keccak256(stringToHex('acme.com'))] }))
    const call = (h.writeContractSync.mock.calls[0] as any)[0]
    expect(call.functionName).toBe('attest')
    expect(call.args).toEqual([wallet, 'Acme Ltd', 'acme.com', '', '0x00000000', 1, expect.stringMatching(/^0x[0-9a-f]{64}$/)])
  })

  test('domain held by this wallet → attest (re-attest), with a registered master and verified LEI', async () => {
    const h = harness({ holder: wallet, payees: { [wallet.toLowerCase()]: livePayee('acme.com') } })
    const out = await h.services.writeAttestation({ ...h.row, leiVerified: 1, masterStatus: 'registered' }, 2)
    expect(out.action).toBe('attest')
    expect((h.writeContractSync.mock.calls[0] as any)[0].args.slice(0, 6)).toEqual([wallet, 'Acme Ltd', 'acme.com', '5493001KJTIIGC8Y1R12', '0x83196cf2', 2])
  })

  test('domain held by another active wallet and this wallet is new → supersede(old, new)', async () => {
    const h = harness({ holder: other, payees: { [other.toLowerCase()]: livePayee('acme.com') } })
    const out = await h.services.writeAttestation(h.row, 1)
    expect(out).toEqual({ txHash: '0xfeed', action: 'supersede' })
    const call = (h.writeContractSync.mock.calls[0] as any)[0]
    expect(call.functionName).toBe('supersede')
    expect(call.args.slice(0, 4)).toEqual([other, wallet, 'Acme Ltd', 'acme.com'])
  })

  test('this wallet is already verified elsewhere and the domain is held by another wallet → 409, no tx', async () => {
    const h = harness({ holder: other, payees: { [other.toLowerCase()]: livePayee('acme.com'), [wallet.toLowerCase()]: livePayee('acme.io') } })
    const err = await h.services.writeAttestation(h.row, 1).catch((e) => e)
    expect(err).toBeInstanceOf(HttpError)
    expect(err.status).toBe(409)
    expect(err.message).toBe('Domain already verified by another wallet')
    expect(h.writeContractSync).not.toHaveBeenCalled()
  })

  test('domain held by a wallet whose record is not current → 409, no tx', async () => {
    const h = harness({ holder: other, payees: { [other.toLowerCase()]: livePayee('acme.com', { revokedAt: 200n }) } })
    const err = await h.services.writeAttestation(h.row, 1).catch((e) => e)
    expect(err.status).toBe(409)
    expect(h.writeContractSync).not.toHaveBeenCalled()
  })

  test('this wallet was superseded or revoked → 409, no tx', async () => {
    const h = harness({ payees: { [wallet.toLowerCase()]: livePayee('acme.com', { supersededAt: 200n, successor: other }) } })
    const err = await h.services.writeAttestation(h.row, 1).catch((e) => e)
    expect(err.status).toBe(409)
    expect(h.writeContractSync).not.toHaveBeenCalled()
  })

  test('a reverted receipt throws', async () => {
    const h = harness({ status: 'reverted' })
    await expect(h.services.writeAttestation(h.row, 1)).rejects.toThrow(/reverted/)
  })
})
