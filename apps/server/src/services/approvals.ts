import { getAddress, type Address, type Hex } from 'viem'
import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import { AllowlistError, buildSetAllowlistCall, isVirtualAddress, withRecipient, type Verdict } from '@bound/core'
import { HttpError } from '../app'
import { newId } from '../crypto'
import type { Db } from '../db/client'
import { approvals, invoices, orgs, payees, pins } from '../db/schema'
import { logEvent, nowSeconds } from './events'
import { withOrgLock } from './mutex'
import { payInvoice, type PayResult, type ServiceDeps } from './payments'
import { isUnrestrictedKey } from './verify-service'

type ApprovalRow = typeof approvals.$inferSelect
type OrgRow = typeof orgs.$inferSelect

const same = (x: string, y: string) => x.toLowerCase() === y.toLowerCase()

/** A 'prepared' approval whose allowlist tx was not confirmed within this window reverts to 'pending'. */
export const PREPARED_TTL_SECONDS = 15 * 60

/** Only these stored verdicts may ever be approved; LOOKALIKE / CHANGED / REVOKED (or anything unreadable) are refused. */
const APPROVABLE: ReadonlySet<Verdict> = new Set<Verdict>(['MATCH', 'CLOSE_MATCH', 'NO_MATCH'])

function storedVerdict(ap: ApprovalRow): string | undefined {
  try { return JSON.parse(ap.verdictJson)?.verdict } catch { return undefined }
}
const approvable = (ap: ApprovalRow) => APPROVABLE.has(storedVerdict(ap) as Verdict)

function assertVerdictApprovable(ap: ApprovalRow) {
  if (!approvable(ap)) throw new HttpError(409, `A ${storedVerdict(ap) ?? 'unknown'} payee cannot be approved`)
}

const isLivePrepared = (ap: Pick<ApprovalRow, 'status' | 'preparedAt'>, now = nowSeconds()) =>
  ap.status === 'prepared' && ap.preparedAt != null && now - ap.preparedAt <= PREPARED_TTL_SECONDS

/** The status as it should be read: an expired 'prepared' approval is 'pending' (it can be prepared again). */
export function approvalStatus(ap: Pick<ApprovalRow, 'status' | 'preparedAt'>, now = nowSeconds()): string {
  return ap.status === 'prepared' && !isLivePrepared(ap, now) ? 'pending' : ap.status
}

/** Resolves a (possibly virtual) destination to the wallet the registry knows it by. */
async function effectiveOf(deps: ServiceDeps, wallet: string): Promise<Address> {
  if (!isVirtualAddress(wallet)) return getAddress(wallet)
  return getAddress((await deps.ops.resolveRecipient(getAddress(wallet))).effective)
}

/** The registry mirror may have moved on since the approval was requested. */
function registryProblem(db: Db, effective: Address): string | null {
  const p = db.select().from(payees).all().find((x) => same(x.wallet, effective))
  if (p?.revokedAt) return 'This wallet\'s verification was revoked'
  if (p?.supersededAt) return 'This wallet was replaced by a new registered wallet'
  return null
}

function loadApproval(db: Db, orgId: string, id: string): ApprovalRow {
  const ap = db.select().from(approvals).where(and(eq(approvals.id, id), eq(approvals.orgId, orgId))).get()
  if (!ap) throw new HttpError(404, 'Approval not found')
  return ap
}

function loadOrg(db: Db, orgId: string): OrgRow {
  const org = db.select().from(orgs).where(eq(orgs.id, orgId)).get()
  if (!org) throw new HttpError(404, 'Org not found')
  return org
}

async function liveAllowlist(deps: ServiceDeps, org: OrgRow): Promise<Address[]> {
  try {
    return (await deps.ops.readAllowlist(getAddress(org.rootAddress), getAddress(org.agentKeyAddress))).map((a) => getAddress(a))
  } catch (e) {
    if (isUnrestrictedKey(e)) throw new HttpError(409, 'The agent key has no recipient restriction; re-scope it before approving payees')
    throw e
  }
}

/**
 * This org's active pinned wallets (literal, as allowlisted) that a registry successor replaces: the
 * pin's effective wallet was superseded by one of `effectiveTargets`.
 */
async function replacedBy(deps: ServiceDeps, orgId: string, effectiveTargets: Address[]): Promise<Address[]> {
  const olds = deps.db.select().from(payees).all()
    .filter((p) => p.successor && effectiveTargets.some((t) => same(t, p.successor!)))
    .map((p) => getAddress(p.wallet))
  if (olds.length === 0) return []
  const orgPins = deps.db.select().from(pins).where(and(eq(pins.orgId, orgId), eq(pins.active, 1))).all()
  const out: Address[] = []
  for (const p of orgPins) {
    const eff = await effectiveOf(deps, p.wallet)
    if (olds.includes(eff)) out.push(getAddress(p.wallet))
  }
  return out
}

/** Creates a pending approval, or reuses a pending/prepared one for the same org + wallet. */
export async function requestApproval(
  deps: Pick<ServiceDeps, 'db'>,
  p: { orgId: string; invoiceId: string; wallet: Address; label: string; verdict: unknown },
): Promise<ApprovalRow> {
  const { db } = deps
  const wallet = getAddress(p.wallet)
  // no await between the lookup and the insert: better-sqlite3 is synchronous, so this cannot interleave
  const open = db.select().from(approvals)
    .where(and(eq(approvals.orgId, p.orgId), inArray(approvals.status, ['pending', 'prepared']))).all()
    .find((a) => same(a.wallet, wallet))
  if (open) return open
  const row: ApprovalRow = {
    id: newId('ap'), orgId: p.orgId, invoiceId: p.invoiceId, wallet, label: p.label,
    verdictJson: JSON.stringify(p.verdict), status: 'pending', txHash: null, createdAt: nowSeconds(), preparedAt: null,
  }
  db.insert(approvals).values(row).run()
  return row
}

export type PreparedApproval = {
  call: { to: Address; data: Hex }
  /** The full list the call sets (setAllowedCalls replaces the whole scope). */
  recipients: Address[]
  /** Wallets in `recipients` only because other approvals are prepared (not yet on the live allowlist). */
  carried: Address[]
}

/**
 * Builds the setAllowedCalls call the human signs. The new list is the live allowlist plus every
 * wallet of this org's other live (< 15 min) `prepared` approvals, minus any pinned wallet that this
 * wallet or a carried wallet succeeds in the registry, plus this approval's wallet.
 */
export function prepareApproval(deps: ServiceDeps, orgId: string, approvalId: string): Promise<PreparedApproval> {
  return withOrgLock(orgId, async () => {
    const { db } = deps
    const now = nowSeconds()
    const ap = loadApproval(db, orgId, approvalId)
    const status = approvalStatus(ap, now)
    if (status !== 'pending' && status !== 'prepared') throw new HttpError(409, `Approval is already ${status}`)
    assertVerdictApprovable(ap)
    const wallet = getAddress(ap.wallet)
    const effective = await effectiveOf(deps, wallet)
    const problem = registryProblem(db, effective)
    if (problem) throw new HttpError(409, problem)
    const org = loadOrg(db, orgId)
    const live = await liveAllowlist(deps, org)

    const others = db.select().from(approvals)
      .where(and(eq(approvals.orgId, orgId), eq(approvals.status, 'prepared'), ne(approvals.id, ap.id))).all()
      .filter((x) => isLivePrepared(x, now) && approvable(x))
    const carriedCandidates: { wallet: Address; effective: Address }[] = []
    for (const x of others) {
      const eff = await effectiveOf(deps, x.wallet)
      if (!registryProblem(db, eff)) carriedCandidates.push({ wallet: getAddress(x.wallet), effective: eff })
    }
    // a superseded wallet must never be (re-)added: replacement is computed over this wallet AND every carried wallet
    const replaced = await replacedBy(deps, orgId, [effective, ...carriedCandidates.map((c) => c.effective)])

    let recipients: Address[]
    let call: { to: Address; data: Hex }
    try {
      recipients = live
      for (const c of carriedCandidates) recipients = withRecipient(recipients, c.wallet)
      recipients = recipients.filter((r) => !replaced.includes(r)) // swap out first so a full list can still take the successor
      recipients = withRecipient(recipients, wallet)
      call = buildSetAllowlistCall({ keyId: getAddress(org.agentKeyAddress), token: deps.chain.token, recipients })
    } catch (e) {
      if (e instanceof AllowlistError) throw new HttpError(409, e.message)
      throw e
    }
    const carried = recipients.filter((r) => r !== wallet && !live.includes(r))
    db.update(approvals).set({ status: 'prepared', preparedAt: now }).where(eq(approvals.id, ap.id)).run()
    return { call, recipients, carried }
  })
}

/**
 * After the human's allowlist tx lands: THIS approval (only) becomes approved and pinned if its wallet
 * is on the live allowlist, and a pinned wallet it succeeds is unpinned. Wallets that rode along from
 * other prepared approvals stay allowlisted but unpinned until their own confirm. Then the linked
 * invoice is paid through the normal, fully re-verified path.
 */
export async function confirmApproval(deps: ServiceDeps, orgId: string, approvalId: string, txHash: Hex): Promise<{ approved: true; payment: PayResult }> {
  const { db } = deps
  const first = loadApproval(db, orgId, approvalId)
  if (first.status === 'rejected') throw new HttpError(409, 'Approval was rejected')
  assertVerdictApprovable(first)

  const receipt = await deps.ops.waitReceipt(txHash)
  if (receipt.status !== 'success') throw new HttpError(409, 'The allowlist update reverted onchain')

  const ap = await withOrgLock(orgId, async () => {
    const ap = loadApproval(db, orgId, approvalId)
    if (ap.status === 'rejected') throw new HttpError(409, 'Approval was rejected')
    const org = loadOrg(db, orgId)
    const live = await liveAllowlist(deps, org)
    if (!live.some((x) => same(x, ap.wallet))) throw new HttpError(409, 'The wallet is not on the agent key allowlist yet')
    if (ap.status === 'approved') return ap

    const now = nowSeconds()
    const wallet = getAddress(ap.wallet)
    const replaced = await replacedBy(deps, orgId, [await effectiveOf(deps, wallet)])
    db.update(approvals).set({ status: 'approved', txHash }).where(eq(approvals.id, ap.id)).run()
    for (const old of replaced) {
      db.update(pins).set({ active: 0 }).where(and(eq(pins.orgId, orgId), sql`lower(${pins.wallet}) = ${old.toLowerCase()}`)).run()
    }
    db.insert(pins).values({ orgId, wallet, label: ap.label, approvedAt: now, txHash, active: 1 })
      .onConflictDoUpdate({ target: [pins.orgId, pins.wallet], set: { label: ap.label, approvedAt: now, txHash, active: 1 } }).run()
    logEvent(db, { orgId, kind: 'approved', invoiceId: ap.invoiceId, txHash, detail: { approvalId: ap.id, wallet, label: ap.label, replaced } })
    return ap
  })

  const payment = await payInvoice(deps, ap.invoiceId)
  return { approved: true, payment }
}

export function rejectApproval(deps: ServiceDeps, orgId: string, approvalId: string): Promise<{ rejected: true }> {
  return withOrgLock(orgId, async () => {
    const { db } = deps
    const ap = loadApproval(db, orgId, approvalId)
    if (ap.status === 'approved') throw new HttpError(409, 'Approval was already approved')
    if (ap.status !== 'rejected') {
      db.update(approvals).set({ status: 'rejected' }).where(eq(approvals.id, ap.id)).run()
      db.update(invoices).set({ status: 'blocked' })
        .where(and(eq(invoices.id, ap.invoiceId), eq(invoices.orgId, orgId), ne(invoices.status, 'paid'))).run()
      logEvent(db, { orgId, kind: 'rejected', invoiceId: ap.invoiceId, detail: { approvalId: ap.id, wallet: ap.wallet, label: ap.label } })
    }
    return { rejected: true as const }
  })
}
