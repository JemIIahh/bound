import { getAddress, type Address, type Hex } from 'viem'
import type { OnchainPayee } from './bound-registry'
import { findLookalike } from './address'
import { findLookalikeDomain, normalizeDomain } from './domain'
import { compareNames, normalizeName } from './names'

export type Verdict = 'MATCH' | 'CLOSE_MATCH' | 'NO_MATCH' | 'LOOKALIKE' | 'CHANGED' | 'REVOKED'
export type ReasonCode = 'verified' | 'pinned' | 'name_close' | 'name_mismatch' | 'homoglyph_name' | 'unregistered' | 'unregistered_virtual' | 'lookalike_address' | 'lookalike_domain' | 'domain_mismatch' | 'wallet_changed' | 'cooling_off' | 'revoked' | 'claims_verified_payee' | 'resembles_verified_payee' | 'domain_of_other_payee'
export type Reason = { code: ReasonCode; detail: string }
export type KnownWallet = { wallet: Address; label: string; source: 'pin' | 'registry' }
export type VerifyInput = {
  address: Address; payeeName: string; senderDomain?: string; now: number
  resolved: { effective: Address; isVirtual: boolean; masterId: Hex | null; registered: boolean }
  payee: OnchainPayee | null
  knownWallets: KnownWallet[]
  registeredDomains: { domain: string; label: string; wallet: Address }[]
  pinned: boolean; allowlisted: boolean
}
export type VerifyResult = {
  verdict: Verdict
  payee: { wallet: Address; legalName: string; domain: string; lei: string; level: 1 | 2 } | null
  suggestedName: string | null
  reasons: Reason[]
  address: Address; effectiveAddress: Address; isVirtual: boolean
  pinned: boolean; allowlisted: boolean
}

const RANK: Verdict[] = ['LOOKALIKE', 'CHANGED', 'REVOKED', 'NO_MATCH', 'CLOSE_MATCH', 'MATCH']

const inDomain = (d: string, root: string) => d === root || d.endsWith('.' + root)

export function evaluate(i: VerifyInput): VerifyResult {
  if (!Number.isFinite(i.now) || i.now <= 0 || i.now > 1e11) throw new Error('evaluate: now must be unix seconds')
  const reasons: Reason[] = []
  const candidates: Verdict[] = []
  const address = getAddress(i.address)
  const effective = getAddress(i.resolved.effective)
  const p = i.payee
  if (p && getAddress(p.wallet) !== effective) throw new Error('evaluate: payee record does not belong to the destination address')
  const unregisteredVirtual = i.resolved.isVirtual && !i.resolved.registered
  const senderDomain = i.senderDomain ? normalizeDomain(i.senderDomain) : null

  // 1. Lookalike address: imitates a known wallet it does not resolve to.
  const imitated = findLookalike(address, i.knownWallets, [effective]) ?? findLookalike(effective, i.knownWallets, [effective])
  if (imitated) {
    reasons.push({ code: 'lookalike_address', detail: `Imitates ${imitated.label} (${imitated.wallet})` })
    candidates.push('LOOKALIKE')
  }

  // 2. Unregistered virtual address: Tempo itself rejects transfers to it.
  if (unregisteredVirtual) {
    reasons.push({ code: 'unregistered_virtual', detail: `masterId ${i.resolved.masterId} is not registered on Tempo` })
    candidates.push('NO_MATCH')
  }

  // 3. Registry status.
  let unregisteredIdx = -1
  if (!p) {
    if (!unregisteredVirtual) {
      reasons.push({ code: 'unregistered', detail: 'No verified company is registered for this address' })
      unregisteredIdx = candidates.push('NO_MATCH') - 1
    }
    if (normalizeName(i.payeeName).homoglyph) reasons.push({ code: 'homoglyph_name', detail: 'Invoice name uses look-alike characters' })

    // Does the invoice claim to be a registry-verified company while paying somewhere else?
    const byDomain = i.registeredDomains.find(
      (d) => senderDomain && inDomain(senderDomain, normalizeDomain(d.domain)) && getAddress(d.wallet) !== effective,
    )
    const companies = [
      ...i.knownWallets.filter((k) => k.source === 'registry'),
      ...i.registeredDomains,
    ].filter((c) => getAddress(c.wallet) !== effective)
    const scored = companies.map((c) => ({ c, n: compareNames(i.payeeName, c.label) }))
    const strong = byDomain ?? scored.find((x) => (x.n.score === 1 || (x.n.homoglyph && x.n.result === 'CLOSE_MATCH')) && x.n.result !== 'NO_MATCH')?.c
    const weak = scored.find((x) => x.n.result === 'CLOSE_MATCH' && x.n.score < 1 && !x.n.homoglyph)?.c
    if (strong) {
      reasons.push({ code: 'claims_verified_payee', detail: `Invoice claims to be ${strong.label} (verified wallet ${strong.wallet}) but pays an unverified address` })
      candidates.push('LOOKALIKE')
    } else if (weak) {
      reasons.push({ code: 'resembles_verified_payee', detail: `Name resembles ${weak.label} (verified wallet ${weak.wallet})` })
      // the resemblance is the more specific finding: report it as CLOSE_MATCH (ASK) rather than a bare NO_MATCH
      if (unregisteredIdx >= 0) candidates.splice(unregisteredIdx, 1)
      candidates.push('CLOSE_MATCH')
    }
  } else {
    if (p.revokedAt) { reasons.push({ code: 'revoked', detail: 'Verification revoked' }); candidates.push('REVOKED') }
    if (p.supersededAt) {
      reasons.push({ code: 'wallet_changed', detail: p.successor ? `${p.legalName} moved to ${p.successor}` : 'Wallet superseded' })
      candidates.push('CHANGED')
    }
    const cooling = p.activeFrom > i.now
    if (cooling) { reasons.push({ code: 'cooling_off', detail: `New wallet active from ${new Date(p.activeFrom * 1000).toISOString()}` }); candidates.push('CHANGED') }
    if (!p.revokedAt && !p.supersededAt && !cooling) reasons.push({ code: 'verified', detail: `${p.legalName} · ${p.domain}${p.lei ? ' · LEI ' + p.lei : ''}` })

    const name = compareNames(i.payeeName, p.legalName)
    if (name.homoglyph) reasons.push({ code: 'homoglyph_name', detail: 'Invoice name uses look-alike characters' })
    if (name.result === 'MATCH') candidates.push('MATCH')
    if (name.result === 'CLOSE_MATCH') { reasons.push({ code: 'name_close', detail: `Registered name is "${p.legalName}"` }); candidates.push('CLOSE_MATCH') }
    if (name.result === 'NO_MATCH') { reasons.push({ code: 'name_mismatch', detail: `Registered name is "${p.legalName}"` }); candidates.push('NO_MATCH') }

    // The payee's own registered domain imitates another verified company's domain (acme-ltd.co vs acme.com):
    // a verified record is not enough to pay without a human look.
    const ownDomain = normalizeDomain(p.domain)
    const others = i.registeredDomains
      .filter((d) => getAddress(d.wallet) !== getAddress(p.wallet))
      .map((d) => ({ ...d, domain: normalizeDomain(d.domain) }))
    const imitatedDomain = findLookalikeDomain(ownDomain, others)
    if (imitatedDomain) {
      reasons.push({ code: 'lookalike_domain', detail: `${p.domain} imitates ${imitatedDomain.domain} (${imitatedDomain.label})` })
      candidates.push('CLOSE_MATCH')
    }
  }

  // 4. Sender domain.
  if (senderDomain) {
    const own = p ? normalizeDomain(p.domain) : null
    if (!(own && inDomain(senderDomain, own))) {
      const otherDomains = i.registeredDomains
        .filter((d) => !p || getAddress(d.wallet) !== getAddress(p.wallet))
        .map((d) => ({ ...d, domain: normalizeDomain(d.domain) }))
      const owner = p ? otherDomains.find((d) => inDomain(senderDomain, d.domain)) : undefined
      const look = owner ? null : findLookalikeDomain(senderDomain, otherDomains)
      if (owner) {
        reasons.push({ code: 'domain_of_other_payee', detail: `Invoice sent from ${senderDomain}, which belongs to ${owner.label}` })
        candidates.push('CLOSE_MATCH')
      } else if (look) {
        reasons.push({ code: 'lookalike_domain', detail: `${senderDomain} imitates ${look.domain} (${look.label})` })
        candidates.push(p ? 'CLOSE_MATCH' : 'LOOKALIKE')
      } else if (own) {
        reasons.push({ code: 'domain_mismatch', detail: `Invoice sent from ${senderDomain}; registered domain is ${own}` })
      }
    }
  }

  if (i.pinned) reasons.push({ code: 'pinned', detail: 'Previously approved by your team' })

  const verdict = RANK.find((v) => candidates.includes(v)) ?? 'NO_MATCH'
  const suggestedName = p && verdict === 'CLOSE_MATCH' ? p.legalName : null
  return {
    verdict,
    payee: p ? { wallet: p.wallet, legalName: p.legalName, domain: p.domain, lei: p.lei, level: p.level } : null,
    suggestedName, reasons, address, effectiveAddress: effective, isVirtual: i.resolved.isVirtual,
    pinned: i.pinned, allowlisted: i.allowlisted,
  }
}
