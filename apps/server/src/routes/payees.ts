import express from 'express'
import { z } from 'zod'
import { getAddress, isAddress, verifyTypedData, type Address, type Hex } from 'viem'
import { desc, eq, or, sql } from 'drizzle-orm'
import { compareNames, normalizeDomain } from '@bound/core'
import { HttpError, type AppDeps } from '../app'
import { newId, newToken } from '../crypto'
import { payees, payeeVerifications } from '../db/schema'
import { productionPayeeServices, type PayeeServices, type PayeeVerificationRow } from '../services/payee-verification'

const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/

const createBody = z.object({
  wallet: z.string().refine((v) => isAddress(v), 'Invalid wallet address').transform((v) => getAddress(v)),
  legalName: z.string().trim().min(2).max(120),
  domain: z.string().max(253).transform(normalizeDomain).refine((d) => DOMAIN_RE.test(d), 'Invalid domain'),
  lei: z.preprocess(
    (v) => (v == null ? undefined : typeof v === 'string' ? v.trim().toUpperCase() || undefined : v), // '' / null = no LEI
    z.string().regex(/^[A-Z0-9]{20}$/, 'LEI must be 20 characters A-Z/0-9').optional(),
  ),
})
const signatureBody = z.object({ signature: z.string().regex(/^0x[0-9a-fA-F]+$/) })
const masterBody = z.object({ txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) })
const searchQuery = z.string().trim().max(100).optional()

type ClaimFields = Pick<PayeeVerificationRow, 'legalName' | 'domain' | 'wallet' | 'nonce'>

/** EIP-712 claim the payee wallet signs to prove control. */
export function payeeClaimTypedData(row: ClaimFields) {
  return {
    domain: { name: 'Bound', version: '1' },
    types: {
      PayeeClaim: [
        { name: 'legalName', type: 'string' },
        { name: 'domain', type: 'string' },
        { name: 'wallet', type: 'address' },
        { name: 'nonce', type: 'string' },
      ],
    },
    primaryType: 'PayeeClaim',
    message: { legalName: row.legalName, domain: row.domain, wallet: row.wallet as Address, nonce: row.nonce },
  } as const
}

const dnsRecordFor = (row: Pick<PayeeVerificationRow, 'domain' | 'nonce'>) =>
  ({ name: `_bound.${row.domain}`, type: 'TXT', value: `bound-verify=${row.nonce}` }) as const

const serialize = (row: PayeeVerificationRow) => ({
  ...row,
  sigVerified: !!row.sigVerified,
  dnsVerified: !!row.dnsVerified,
  leiVerified: !!row.leiVerified,
  dns: dnsRecordFor(row),
  typedData: payeeClaimTypedData(row),
})

const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`

export function payeesRouter(deps: AppDeps, services: PayeeServices = productionPayeeServices(deps)): express.Router {
  const { db } = deps
  const r = express.Router()
  const attesting = new Set<string>()

  const load = (id: string) => {
    const row = db.select().from(payeeVerifications).where(eq(payeeVerifications.id, id)).get()
    if (!row) throw new HttpError(404, 'Verification not found')
    return row
  }
  const update = (id: string, values: Partial<PayeeVerificationRow>) =>
    db.update(payeeVerifications).set(values).where(eq(payeeVerifications.id, id)).run()

  r.post('/payee-verifications', (req, res) => {
    const body = createBody.parse(req.body)
    const row = {
      id: newId('pv'),
      wallet: body.wallet,
      legalName: body.legalName,
      domain: body.domain,
      lei: body.lei ?? '',
      nonce: newToken(),
      createdAt: Math.floor(Date.now() / 1000),
    }
    db.insert(payeeVerifications).values(row).run()
    res.status(201).json({ id: row.id, dns: dnsRecordFor(row), typedData: payeeClaimTypedData(row) })
  })

  r.get('/payee-verifications/:id', (req, res) => {
    res.json(serialize(load(req.params.id)))
  })

  r.post('/payee-verifications/:id/signature', async (req, res) => {
    const row = load(req.params.id)
    const { signature } = signatureBody.parse(req.body)
    const sigVerified = await verifyTypedData({ address: row.wallet as Address, ...payeeClaimTypedData(row), signature: signature as Hex }).catch(() => false)
    // A failed attempt never downgrades a wallet that already proved control.
    if (sigVerified) update(row.id, { signature, sigVerified: 1 })
    res.json({ sigVerified })
  })

  r.post('/payee-verifications/:id/check-dns', async (req, res) => {
    const row = load(req.params.id)
    const found = await services.resolveTxt(`_bound.${row.domain}`)
    const expected = dnsRecordFor(row).value
    const dnsVerified = found.some((v) => v.trim() === expected)
    update(row.id, { dnsVerified: dnsVerified ? 1 : 0 })
    res.json({ dnsVerified, found })
  })

  r.post('/payee-verifications/:id/check-lei', async (req, res) => {
    const row = load(req.params.id)
    if (!row.lei) throw new HttpError(409, 'No LEI on this verification')
    const record = await services.lookupLei(row.lei)
    const leiVerified = !!record && record.status === 'ISSUED' && compareNames(row.legalName, record.legalName).result !== 'NO_MATCH'
    update(row.id, { leiVerified: leiVerified ? 1 : 0, leiRecordJson: record ? JSON.stringify(record) : null })
    res.json(record ? { leiVerified, legalName: record.legalName, status: record.status } : { leiVerified })
  })

  r.post('/payee-verifications/:id/mine-master', (req, res) => {
    const row = load(req.params.id)
    if (!row.sigVerified) throw new HttpError(409, 'Wallet signature required')
    if (row.masterStatus === 'mining') {
      res.status(202).json({ masterStatus: 'mining' })
      return
    }
    if (row.masterId) {
      // Already mined (the salt is deterministic): register it / re-check via /master instead.
      res.json({ masterStatus: row.masterStatus })
      return
    }
    update(row.id, { masterStatus: 'mining' })
    services.startMining(row.id, getAddress(row.wallet))
    res.status(202).json({ masterStatus: 'mining' })
  })

  r.post('/payee-verifications/:id/master', async (req, res) => {
    const row = load(req.params.id)
    const { txHash } = masterBody.parse(req.body)
    if (!row.masterId) throw new HttpError(409, 'No mined virtual master for this verification')
    const ok = await services.checkMaster(row.masterId as Hex, getAddress(row.wallet), txHash as Hex)
    const masterStatus = ok ? 'registered' : 'failed'
    update(row.id, { masterStatus })
    res.json({ masterStatus })
  })

  r.post('/payee-verifications/:id/attest', async (req, res) => {
    const row = load(req.params.id)
    if (row.status === 'attested') throw new HttpError(409, 'Already attested')
    if (!row.sigVerified || !row.dnsVerified) throw new HttpError(409, 'Signature and DNS proof required')
    if (attesting.has(row.id)) throw new HttpError(409, 'Attestation already in progress')
    attesting.add(row.id)
    try {
      const level: 1 | 2 = row.leiVerified ? 2 : 1
      const out = await services.writeAttestation(row, level).catch((e) => {
        if (!(e instanceof HttpError)) update(row.id, { status: 'failed' })
        throw e
      })
      update(row.id, { attestTx: out.txHash, status: 'attested' })
      res.json({ txHash: out.txHash, level, action: out.action })
    } finally {
      attesting.delete(row.id)
    }
  })

  r.get('/payees', (req, res) => {
    const q = searchQuery.parse(req.query.q)
    const base = db.select().from(payees)
    const rows = q
      ? base
          .where(or(sql`${payees.legalName} LIKE ${likePattern(q)} ESCAPE '\\'`, sql`${payees.domain} LIKE ${likePattern(q)} ESCAPE '\\'`))
          .orderBy(payees.legalName)
          .limit(20)
          .all()
      : base.orderBy(desc(payees.updatedBlock)).limit(20).all()
    res.json({ payees: rows })
  })

  r.get('/payees/:wallet', (req, res) => {
    const wallet = req.params.wallet
    if (!isAddress(wallet, { strict: false })) throw new HttpError(400, 'Invalid wallet address')
    const row = db.select().from(payees).where(eq(payees.wallet, getAddress(wallet))).get()
    if (!row) throw new HttpError(404, 'Payee not found')
    res.json(row)
  })

  return r
}
