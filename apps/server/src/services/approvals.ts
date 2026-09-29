import { getAddress, type Address, type Hex } from 'viem'
import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import { AllowlistError, buildSetAllowlistCall, withRecipient, type Verdict } from '@bound/core'
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

/** Only these stored verdicts may ever be approved; LOOKALIKE / CHANGED / REVOKED (or anything unreadable) are refused. */
const APPROVABLE: ReadonlySet<Verdict> = new Set<Verdict>(['MATCH', 'CLOSE_MATCH', 'NO_MATCH'])

function storedVerdict(ap: ApprovalRow): string | undefined {
  try { return JSON.parse(ap.verdictJson)?.verdict } catch { return undefined }
}

function assertVerdictApprovable(ap: ApprovalRow) {
  const v = storedVerdict(ap)
  if (!v || !APPROVABLE.has(v as Verdict)) throw new HttpError(409, `A ${v ?? 'unknown'} payee cannot be approved`)
}

/** The registry mirror may have moved on since the approval was requested. */
function registryProblem(db: Db, wallet: string): string | null {
  const p = db.select().from(payees).all().find((x) => same(x.wallet, wallet))
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

/** Wallets this org has pinned whose registry successor is `wallet` (the approval replaces them). */
function replacedBy(db: Db, orgId: string, wallet: string): Address[] {
  const olds = db.select().from(payees).all().filter((p) => p.successor && same(p.successor, wallet))
  if (olds.length === 0) return []
  const orgPins = db.select().from(pins).where(and(eq(pins.orgId, orgId), eq(pins.active, 1))).all()
  return olds.filter((o) => orgPins.some((p) => same(p.wallet, o.wallet))).map((o) => getAddress(o.wallet))
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
    verdictJson: JSON.stringify(p.verdict), status: 'pending', txHash: null, createdAt: nowSeconds(),
  }
  db.insert(approvals).values(row).run()
  return row
}

/**
 * Builds the setAllowedCalls call the human signs. The new list is the live allowlist plus every
 * wallet of this org's other `prepared` approvals (so two approvals prepared before either tx lands
 * never drop each other), minus a pinned wallet this one succeeds, plus this approval's wallet.
 */
export function prepareApproval(deps: ServiceDeps, orgId: string, approvalId: string): Promise<{ call: { to: Address; data: Hex }; recipients: Address[] }> {
  return withOrgLock(orgId, async () => {
    const { db } = deps
    const ap = loadApproval(db, orgId, approvalId)
    if (ap.status !== 'pending' && ap.status !== 'prepared') throw new HttpError(409, `Approval is already ${ap.status}`)
    assertVerdictApprovable(ap)
    const problem = registryProblem(db, ap.wallet)
    if (problem) throw new HttpError(409, problem)
    const org = loadOrg(db, orgId)
    const live = await liveAllowlist(deps, org)

    const carried = db.select().from(approvals)
      .where(and(eq(approvals.orgId, orgId), eq(approvals.status, 'prepared'), ne(approvals.id, ap.id))).all()
      .filter((x) => APPROVABLE.has(storedVerdict(x) as Verdict) && !registryProblem(db, x.wallet))
    const wallet = getAddress(ap.wallet)
    const replaced = replacedBy(db, orgId, wallet)

    let recipients: Address[]
    let call: { to: Address; data: Hex }
    try {
      recipients = live
      for (const c of carried) recipients = withRecipient(recipients, c.wallet as Address)
      recipients = recipients.filter((r) => !replaced.includes(r)) // swap out first so a full list can still take the successor
      recipients = withRecipient(recipients, wallet)
      call = buildSetAllowlistCall({ keyId: getAddress(org.agentKeyAddress), token: deps.chain.token, recipients })
    } catch (e) {
      if (e instanceof AllowlistError) throw new HttpError(409, e.message)
      throw e
    }
    db.update(approvals).set({ status: 'prepared' }).where(eq(approvals.id, ap.id)).run()
    return { call, recipients }
  })
}

/**
 * After the human's allowlist tx lands: every pending/prepared approval of this org whose wallet is
 * now on the live allowlist becomes approved and pinned (a replaced wallet's pin is deactivated),
 * then the linked invoice is paid through the normal, fully re-verified path.
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
    const onList = (w: string) => live.some((x) => same(x, w))
    if (!onList(ap.wallet)) throw new HttpError(409, 'The wallet is not on the agent key allowlist yet')

    const now = nowSeconds()
    const open = db.select().from(approvals)
      .where(and(eq(approvals.orgId, orgId), inArray(approvals.status, ['pending', 'prepared']))).all()
      .filter((x) => (x.id === ap.id || x.status === 'prepared') && onList(x.wallet) && APPROVABLE.has(storedVerdict(x) as Verdict))
    for (const x of open) {
      const wallet = getAddress(x.wallet)
      db.update(approvals).set({ status: 'approved', txHash }).where(eq(approvals.id, x.id)).run()
      for (const old of replacedBy(db, orgId, wallet)) {
        db.update(pins).set({ active: 0 }).where(and(eq(pins.orgId, orgId), sql`lower(${pins.wallet}) = ${old.toLowerCase()}`)).run()
      }
      db.insert(pins).values({ orgId, wallet, label: x.label, approvedAt: now, txHash, active: 1 })
        .onConflictDoUpdate({ target: [pins.orgId, pins.wallet], set: { label: x.label, approvedAt: now, txHash, active: 1 } }).run()
      logEvent(db, { orgId, kind: 'approved', invoiceId: x.invoiceId, txHash, detail: { approvalId: x.id, wallet, label: x.label } })
    }
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
