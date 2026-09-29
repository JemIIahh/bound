import { getAddress, type Address, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts'
import { and, count, desc, eq, ne } from 'drizzle-orm'
import { buildAuthorizeKeyCall, MAX_RECIPIENTS, parseAmount } from '@bound/core'
import { HttpError } from '../app'
import { encryptSecret, newId, newToken, sha256 } from '../crypto'
import { approvals, events, invoices, orgs, payments, pins } from '../db/schema'
import { approvalStatus } from './approvals'
import { nowSeconds } from './events'
import type { ServiceDeps } from './payments'
import { isUnrestrictedKey } from './verify-service'

const KEY_LIFETIME_SECONDS = 180 * 86400
/** The server-side demo signer may only authorize keys with a limit of at most 50 USD (6 decimals). */
const DEMO_MAX_LIMIT_BASE = 50_000_000n

type OrgRow = typeof orgs.$inferSelect

/** The address of DEMO_ROOT_PRIVATE_KEY, or null when unset or malformed. */
function demoRootAddress(deps: ServiceDeps): Address | null {
  const key = deps.config.demoRootKey
  if (!key) return null
  try { return privateKeyToAddress(key) } catch { return null }
}

function loadOrg(deps: ServiceDeps, orgId: string): OrgRow {
  const org = deps.db.select().from(orgs).where(eq(orgs.id, orgId)).get()
  if (!org) throw new HttpError(404, 'Org not found')
  return org
}

function authorizeCallFor(deps: ServiceDeps, p: { agentKeyAddress: Address; rootAddress: Address; limit: bigint; periodSeconds: number }) {
  return buildAuthorizeKeyCall({
    keyId: p.agentKeyAddress, token: deps.chain.token, limit: p.limit, periodSeconds: BigInt(p.periodSeconds),
    expiry: BigInt(nowSeconds() + KEY_LIFETIME_SECONDS),
    recipients: [p.rootAddress], // sentinel: the key can pay nobody but the org itself until a human approves a payee
  })
}

/**
 * Creates an org and its agent access key. Bound keeps only this scoped key (encrypted at rest);
 * the human signs `authorizeCall` with their root account.
 */
export async function createOrg(deps: ServiceDeps, input: { name: string; rootAddress: Address; limitUsd: string; periodSeconds: number }) {
  const rootAddress = getAddress(input.rootAddress)
  let limit: bigint
  try { limit = parseAmount(input.limitUsd) } catch (e) { throw new HttpError(400, (e as Error).message) }
  if (limit <= 0n) throw new HttpError(400, 'limitUsd must be greater than zero')
  if (demoRootAddress(deps) === rootAddress && limit > DEMO_MAX_LIMIT_BASE) throw new HttpError(400, 'Demo orgs are limited to 50 USD per period')

  const pk = generatePrivateKey()
  const agentKeyAddress = privateKeyToAddress(pk)
  const authorizeCall = authorizeCallFor(deps, { agentKeyAddress, rootAddress, limit, periodSeconds: input.periodSeconds })
  const token = newToken()
  const id = newId('org')
  deps.db.insert(orgs).values({
    id, name: input.name, rootAddress, agentKeyAddress,
    agentKeyEnc: encryptSecret(pk, deps.config.serverSecret), tokenHash: sha256(token),
    limitBase: limit.toString(), periodSeconds: input.periodSeconds, authorized: 0, createdAt: nowSeconds(),
  }).run()
  return { org: { id, name: input.name, rootAddress, agentKeyAddress }, token, authorizeCall }
}

/** The key must exist, be live, carry a spending limit and a recipient restriction before Bound will use it. */
async function assertKeyUsable(deps: ServiceDeps, org: OrgRow) {
  const root = getAddress(org.rootAddress)
  const keyId = getAddress(org.agentKeyAddress)
  const key = await deps.ops.readKey(root, keyId)
  if (key.isRevoked || key.expiry === 0n || key.expiry <= BigInt(nowSeconds())) throw new HttpError(409, 'The agent key is not active onchain')
  if (!key.enforceLimits) throw new HttpError(409, 'The agent key has no spending limit')
  try {
    await deps.ops.readAllowlist(root, keyId)
  } catch (e) {
    if (isUnrestrictedKey(e)) throw new HttpError(409, 'The agent key has no recipient restriction')
    throw e
  }
}

export async function confirmAuthorization(deps: ServiceDeps, orgId: string, txHash: Hex) {
  const org = loadOrg(deps, orgId)
  const receipt = await deps.ops.waitReceipt(txHash)
  if (receipt.status !== 'success') throw new HttpError(409, 'The authorization transaction reverted')
  await assertKeyUsable(deps, org)
  deps.db.update(orgs).set({ authorized: 1, authorizeTx: txHash }).where(eq(orgs.id, orgId)).run()
  return { authorized: true as const }
}

/**
 * Demo only: when DEMO_ROOT_PRIVATE_KEY controls this org's root (and its limit is ≤ 50 USD), sign the authorization
 * server-side. With DEMO_ORG_ID set, only that org qualifies.
 */
export async function authorizeDemo(deps: ServiceDeps, orgId: string) {
  const org = loadOrg(deps, orgId)
  const demoRoot = demoRootAddress(deps)
  if (!demoRoot) throw new HttpError(404, 'Demo authorization is not enabled')
  // DEMO_ORG_ID pins the server-side demo signer to the seeded demo org: nobody can create another
  // org with the demo root and make the demo key sign (and pay fees) for it.
  if (deps.config.demoOrgId && org.id !== deps.config.demoOrgId) throw new HttpError(403, 'This org is not the demo org')
  const root = getAddress(org.rootAddress)
  if (demoRoot !== root) throw new HttpError(403, 'This org\'s root is not the demo account')
  if (BigInt(org.limitBase) > DEMO_MAX_LIMIT_BASE) throw new HttpError(403, 'Demo orgs are limited to 50 USD per period')
  if (org.authorized) return { authorized: true as const }
  const call = authorizeCallFor(deps, { agentKeyAddress: getAddress(org.agentKeyAddress), rootAddress: root, limit: BigInt(org.limitBase), periodSeconds: org.periodSeconds })
  const txHash = await deps.ops.sendDemoRoot(call)
  return confirmAuthorization(deps, orgId, txHash)
}

const parseJson = (s: string | null) => {
  if (!s) return null
  try { return JSON.parse(s) } catch { return null }
}

export async function getOverview(deps: ServiceDeps, orgId: string) {
  const { db } = deps
  const org = loadOrg(deps, orgId)
  const root = getAddress(org.rootAddress)
  const keyId = getAddress(org.agentKeyAddress)

  let allowlist: Address[] = []
  let remaining: string | null = null
  let keyStatus: 'unauthorized' | 'ok' | 'unrestricted' | 'unavailable' = 'unauthorized'
  if (org.authorized) {
    const [al, rem] = await Promise.allSettled([deps.ops.readAllowlist(root, keyId), deps.ops.remainingLimit(root, keyId)])
    if (al.status === 'fulfilled') { allowlist = al.value; keyStatus = 'ok' } else keyStatus = isUnrestrictedKey(al.reason) ? 'unrestricted' : 'unavailable'
    if (rem.status === 'fulfilled') remaining = rem.value.toString()
  }

  const invoiceRows = db.select({
    id: invoices.id, payeeName: invoices.payeeName, address: invoices.address, amountBase: invoices.amountBase,
    currency: invoices.currency, invoiceNo: invoices.invoiceNo, senderDomain: invoices.senderDomain, dueDate: invoices.dueDate,
    verdictJson: invoices.verdictJson, action: invoices.action, status: invoices.status, lab: invoices.lab, createdAt: invoices.createdAt,
  }).from(invoices).where(eq(invoices.orgId, orgId)).orderBy(desc(invoices.createdAt)).limit(50).all()
  const approvalRows = db.select().from(approvals).where(eq(approvals.orgId, orgId)).orderBy(desc(approvals.createdAt)).limit(100).all()
  const eventRows = db.select().from(events).where(and(eq(events.orgId, orgId), ne(events.kind, 'check'))).orderBy(desc(events.createdAt)).limit(100).all()

  // counters describe real traffic only: attack-lab invoices (lab = 1) and their payments are left out
  const blocked = db.select({ amountBase: invoices.amountBase }).from(invoices).where(and(eq(invoices.orgId, orgId), eq(invoices.status, 'blocked'), eq(invoices.lab, 0))).all()
  const protectedBase = blocked.reduce((sum, r) => { try { return sum + BigInt(r.amountBase ?? '0') } catch { return sum } }, 0n)
  const checks = db.select({ n: count() }).from(events).where(and(eq(events.orgId, orgId), eq(events.kind, 'check'))).get()?.n ?? 0
  const paid = db.select({ n: count() }).from(payments).innerJoin(invoices, eq(invoices.id, payments.invoiceId))
    .where(and(eq(payments.orgId, orgId), eq(payments.status, 'confirmed'), eq(invoices.lab, 0))).get()?.n ?? 0

  return {
    org: {
      id: org.id, name: org.name, rootAddress: root, agentKeyAddress: keyId, limitBase: org.limitBase,
      periodSeconds: org.periodSeconds, authorized: org.authorized === 1, authorizeTx: org.authorizeTx, createdAt: org.createdAt,
    },
    keyStatus,
    allowlist,
    capacity: { used: allowlist.length, max: MAX_RECIPIENTS },
    remaining,
    pins: db.select().from(pins).where(eq(pins.orgId, orgId)).all(),
    approvals: approvalRows.map(({ verdictJson, ...a }) => ({ ...a, status: approvalStatus(a), verdict: parseJson(verdictJson) })),
    invoices: invoiceRows.map(({ verdictJson, ...i }) => ({ ...i, verdict: parseJson(verdictJson) })),
    payments: db.select().from(payments).where(eq(payments.orgId, orgId)).orderBy(desc(payments.createdAt)).limit(100).all(),
    events: eventRows.map(({ detailJson, ...e }) => ({ ...e, detail: parseJson(detailJson) })),
    counters: { checks, paid, blocked: blocked.length, protectedBase: protectedBase.toString() },
  }
}
