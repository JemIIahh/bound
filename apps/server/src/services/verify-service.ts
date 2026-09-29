import { getAddress, type Address, type Hex } from 'viem'
import { and, eq } from 'drizzle-orm'
import { AllowlistError, decideAction, evaluate, normalizeDomain, type Action, type KnownWallet, type OnchainPayee, type VerifyResult } from '@bound/core'
import { HttpError } from '../app'
import { newId } from '../crypto'
import { orgs, payees, pins } from '../db/schema'
import { logEvent, nowSeconds } from './events'
import type { ServiceDeps } from './payments'

export type VerifyOutput = VerifyResult & {
  action: Action
  checkId: string
  /** Set when the org's agent key has no recipient restriction (readAllowlist threw "unrestricted:"). Never payable. */
  keyUnrestricted?: true
}

type PayeeRow = typeof payees.$inferSelect

const same = (x: string, y: string) => x.toLowerCase() === y.toLowerCase()

/** True for the fail-closed AllowlistError that readAllowlist throws when anyone could be paid. */
export const isUnrestrictedKey = (e: unknown) =>
  (e instanceof AllowlistError || (e as { constructor?: { name?: string } } | null)?.constructor?.name === 'AllowlistError') &&
  String((e as Error).message).startsWith('unrestricted:')

function mirrorToOnchain(r: PayeeRow, wallet: Address): OnchainPayee {
  return {
    wallet,
    legalName: r.legalName,
    domain: r.domain,
    lei: r.lei,
    masterId: r.masterId as Hex,
    level: r.level === 2 ? 2 : 1,
    verifiedAt: r.activeFrom, // the mirror does not store verifiedAt; evaluate() does not read it
    activeFrom: r.activeFrom,
    supersededAt: r.supersededAt,
    revokedAt: r.revokedAt,
    successor: r.successor ? getAddress(r.successor) : null,
    evidenceHash: r.evidenceHash as Hex,
  }
}

/**
 * Verifies a payee for a payment to `address`. The registry record is loaded by the RESOLVED
 * effective address (a virtual address resolves to its master), while pins and the agent-key
 * allowlist are matched against the literal destination, because Tempo allowlists match the literal `to`.
 * Throws on any lookup/evaluation failure: callers must treat a throw as "do not pay".
 */
export async function verifyPayee(
  deps: ServiceDeps,
  input: { address: Address; payeeName: string; senderDomain?: string; orgId?: string },
): Promise<VerifyOutput> {
  const { db, ops } = deps
  const address = getAddress(input.address)
  const org = input.orgId ? db.select().from(orgs).where(eq(orgs.id, input.orgId)).get() : undefined
  if (input.orgId && !org) throw new HttpError(404, 'Org not found')

  const r = await ops.resolveRecipient(address)
  const resolved = { ...r, effective: getAddress(r.effective) }

  const mirror = db.select().from(payees).all()
  const own = mirror.find((p) => same(p.wallet, resolved.effective))
  const payee = own ? mirrorToOnchain(own, resolved.effective) : await ops.readPayee(resolved.effective)

  const active = mirror.filter((p) => !p.revokedAt && !p.supersededAt)
  const orgPins = org ? db.select().from(pins).where(and(eq(pins.orgId, org.id), eq(pins.active, 1))).all() : []
  const knownWallets: KnownWallet[] = [
    ...active.map((p) => ({ wallet: getAddress(p.wallet), label: p.legalName, source: 'registry' as const })),
    ...orgPins.map((p) => ({ wallet: getAddress(p.wallet), label: p.label, source: 'pin' as const })),
  ]
  // A domain's age is its earliest registration, superseded records included: a wallet rotation must not
  // make the incumbent look newer than a lookalike registered in between. Revoked records never count.
  const since = new Map<string, number>()
  for (const p of mirror) {
    if (p.revokedAt) continue
    const d = normalizeDomain(p.domain)
    since.set(d, Math.min(since.get(d) ?? Infinity, p.activeFrom))
  }
  const registeredDomains = active.map((p) => ({ domain: p.domain, label: p.legalName, wallet: getAddress(p.wallet), since: since.get(normalizeDomain(p.domain)) }))
  const pinned = orgPins.some((p) => same(p.wallet, address))

  let allowlisted = false
  let keyUnrestricted = false
  if (org) {
    try {
      const list = await ops.readAllowlist(getAddress(org.rootAddress), getAddress(org.agentKeyAddress))
      allowlisted = list.some((x) => same(x, address))
    } catch (e) {
      if (!isUnrestrictedKey(e)) throw e
      keyUnrestricted = true // hard misconfiguration: never report allowlisted
    }
  }

  const result = evaluate({
    address, payeeName: input.payeeName, senderDomain: input.senderDomain, now: nowSeconds(),
    resolved, payee, knownWallets, registeredDomains, pinned, allowlisted,
  })
  const action = decideAction(result)
  const checkId = newId('chk')
  if (org) {
    logEvent(db, {
      id: checkId, orgId: org.id, kind: 'check',
      detail: { address, payeeName: input.payeeName, verdict: result.verdict, action, ...(keyUnrestricted ? { keyUnrestricted: true } : {}) },
    })
  }
  return { ...result, action, checkId, ...(keyUnrestricted ? { keyUnrestricted: true as const } : {}) }
}
