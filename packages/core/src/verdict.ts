import { getAddress, type Address, type Hex } from 'viem'
import type { OnchainPayee } from './bound-registry'
import { findLookalike } from './address'
import { findLookalikeDomain, normalizeDomain } from './domain'
import { compareNames, normalizeName } from './names'

export type Verdict = 'MATCH' | 'CLOSE_MATCH' | 'NO_MATCH' | 'LOOKALIKE' | 'CHANGED' | 'REVOKED'
export type ReasonCode = 'verified' | 'pinned' | 'name_close' | 'name_mismatch' | 'homoglyph_name' | 'unregistered' | 'unregistered_virtual' | 'lookalike_address' | 'lookalike_domain' | 'domain_mismatch' | 'wallet_changed' | 'cooling_off' | 'revoked' | 'claims_verified_payee'
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
  if (i.now > 1e11) throw new Error('evaluate: now must be unix seconds')
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
  if (!p) {
    if (!unregisteredVirtual) {
      reasons.push({ code: 'unregistered', detail: 'No verified company is registered for this address' })
      candidates.push('NO_MATCH')
    }
    if (normalizeName(i.payeeName).homoglyph) reasons.push({ code: 'homoglyph_name', detail: 'Invoice name uses look-alike characters' })

    // Does the invoice claim to be a registry-verified company while paying somewhere else?
    const byDomain = i.registeredDomains.find(
      (d) => senderDomain && inDomain(senderDomain, normalizeDomain(d.domain)) && getAddress(d.wallet) !== effective,
    )
    const companies = [
      ...i.knownWallets.filter((k) => k.source === 'registry'),
      ...i.registeredDomains,
    ]
    const claimed =
      byDomain ??
      companies.find((c) => {
        if (getAddress(c.wallet) === effective) return false
        const n = compareNames(i.payeeName, c.label)
        return n.result !== 'NO_MATCH' || n.homoglyph
      })
    if (claimed) {
      reasons.push({ code: 'claims_verified_payee', detail: `Invoice claims to be ${claimed.label} (verified wallet ${claimed.wallet}) but pays an unverified address` })
      candidates.push('LOOKALIKE')
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
  }

  // 4. Sender domain.
  if (senderDomain) {
    const own = p ? normalizeDomain(p.domain) : null
    if (!(own && inDomain(senderDomain, own))) {
      const others = i.registeredDomains
        .filter((d) => !p || getAddress(d.wallet) !== getAddress(p.wallet))
        .map((d) => ({ ...d, domain: normalizeDomain(d.domain) }))
      const look = findLookalikeDomain(senderDomain, others)
      if (look) {
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
