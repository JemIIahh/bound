import { describe, expect, test, vi } from 'vitest'
import request from 'supertest'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { keccak256, stringToHex, zeroAddress, type Address } from 'viem'
import { eq } from 'drizzle-orm'
import { createDb, migrate } from '../src/db/client'
import { createApp, finalize, HttpError } from '../src/app'
import { payees, payeeVerifications } from '../src/db/schema'
import { payeesRouter } from '../src/routes/payees'
import { productionPayeeServices } from '../src/services/payee-verification'

function setup(over: Partial<Parameters<typeof payeesRouter>[1]> = {}) {
  const db = createDb(':memory:'); migrate(db)
  const deps = { db, chain: { network: 'testnet' } as any, config: { webOrigin: '*', registry: '0x' + '99'.repeat(20) } as any }
  const mocks = {
    resolveTxt: vi.fn(async () => [] as string[]),
    lookupLei: vi.fn(async () => null as any),
    writeAttestation: vi.fn(async () => ({ txHash: '0xabc' as `0x${string}`, action: 'attest' as const })),
    startMining: vi.fn(),
    checkMaster: vi.fn(async () => true),
  }
  // Overrides are vi.fn mocks too; keep the mock types so tests can call mockResolvedValueOnce.
  const services = { ...mocks, ...over } as typeof mocks
  const app = createApp(deps)
  app.use('/v1', payeesRouter(deps, services))
  finalize(app)
  return { app, db, services }
}

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
    services.resolveTxt.mockResolvedValueOnce([created.body.dns.value])
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

async function signedAndDnsVerified(app: any, services: any, domain = 'acme.com') {
  const acct = privateKeyToAccount(generatePrivateKey())
  const created = await request(app).post('/v1/payee-verifications').send({ wallet: acct.address, legalName: 'Acme Ltd', domain })
  const sig = await acct.signTypedData(created.body.typedData)
  await request(app).post(`/v1/payee-verifications/${created.body.id}/signature`).send({ signature: sig })
  services.resolveTxt.mockResolvedValueOnce([created.body.dns.value])
  await request(app).post(`/v1/payee-verifications/${created.body.id}/check-dns`)
  return { id: created.body.id as string, acct }
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
    const row = db.select().from(payeeVerifications).where(eq(payeeVerifications.id, id)).get()!
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

  test('virtual master: mine requires signature, then register is checked onchain', async () => {
    const { app, db, services } = setup()
    const unsigned = await request(app).post('/v1/payee-verifications').send({ wallet: '0x' + '11'.repeat(20), legalName: 'Acme Ltd', domain: 'acme.com' })
    expect((await request(app).post(`/v1/payee-verifications/${unsigned.body.id}/mine-master`)).status).toBe(409)

    const { id, acct } = await signedAndDnsVerified(app, services)
    expect((await request(app).post(`/v1/payee-verifications/${id}/master`).send({ txHash: '0x' + 'ab'.repeat(32) })).status).toBe(409)
    const m = await request(app).post(`/v1/payee-verifications/${id}/mine-master`)
    expect(m.status).toBe(202)
    expect(m.body).toEqual({ masterStatus: 'mining' })
    expect(services.startMining).toHaveBeenCalledWith(id, acct.address)
    expect((await request(app).get(`/v1/payee-verifications/${id}`)).body.masterStatus).toBe('mining')

    // Mining finished (what the production miner writes).
    db.update(payeeVerifications).set({ salt: '0x' + '00'.repeat(28) + 'abf52baf', masterId: '0x83196cf2', masterStatus: 'mined' }).where(eq(payeeVerifications.id, id)).run()
    const g = await request(app).get(`/v1/payee-verifications/${id}`)
    expect(g.body).toMatchObject({ id, masterStatus: 'mined', masterId: '0x83196cf2', salt: expect.stringMatching(/^0x[0-9a-f]{64}$/), sigVerified: true, dnsVerified: true })

    const txHash = '0x' + 'ab'.repeat(32)
    const r = await request(app).post(`/v1/payee-verifications/${id}/master`).send({ txHash })
    expect(r.body).toEqual({ masterStatus: 'registered' })
    expect(services.checkMaster).toHaveBeenCalledWith('0x83196cf2', acct.address, txHash)

    services.checkMaster.mockResolvedValueOnce(false)
    const r2 = await request(app).post(`/v1/payee-verifications/${id}/master`).send({ txHash })
    expect(r2.body).toEqual({ masterStatus: 'failed' })
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

describe('productionPayeeServices.writeAttestation (BoundRegistry guards)', () => {
  const registry = ('0x' + '99'.repeat(20)) as Address
  const wallet = '0xCcB7f43C7D6DBbC4e545d8C01761098da5332ED2' as Address
  const other = '0x2222222222222222222222222222222222222222' as Address
  const emptyPayee = { legalName: '', domain: '', lei: '', masterId: '0x00000000', level: 0, verifiedAt: 0n, activeFrom: 0n, supersededAt: 0n, revokedAt: 0n, successor: zeroAddress, evidenceHash: '0x' + '00'.repeat(32) }
  const livePayee = (domain: string, over: Record<string, unknown> = {}) => ({ ...emptyPayee, legalName: 'X', domain, level: 1, verifiedAt: 100n, activeFrom: 100n, ...over })

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
