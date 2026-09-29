import { getAddress, type Address, type Hex } from 'viem'
import type { OnchainPayee } from './bound-registry'
import { findLookalike } from './address'
import { findLookalikeDomain, normalizeDomain } from './domain'
import { compareNames } from './names'

export type Verdict = 'MATCH' | 'CLOSE_MATCH' | 'NO_MATCH' | 'LOOKALIKE' | 'CHANGED' | 'REVOKED'
export type ReasonCode = 'verified' | 'pinned' | 'name_close' | 'name_mismatch' | 'homoglyph_name' | 'unregistered' | 'unregistered_virtual' | 'lookalike_address' | 'lookalike_domain' | 'domain_mismatch' | 'wallet_changed' | 'cooling_off' | 'revoked'
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

export function evaluate(i: VerifyInput): VerifyResult {
  const reasons: Reason[] = []
  const candidates: Verdict[] = []
  const address = getAddress(i.address)
  const effective = getAddress(i.resolved.effective)
  const p = i.payee

  // 1. Lookalike address: imitates a known wallet it does not resolve to.
  const imitated = findLookalike(address, i.knownWallets, [effective]) ?? findLookalike(effective, i.knownWallets, [effective])
  if (imitated) {
    reasons.push({ code: 'lookalike_address', detail: `Imitates ${imitated.label} (${imitated.wallet})` })
    candidates.push('LOOKALIKE')
  }

  // 2. Unregistered virtual address — Tempo itself rejects transfers to it.
  if (i.resolved.isVirtual && !i.resolved.registered) {
    reasons.push({ code: 'unregistered_virtual', detail: `masterId ${i.resolved.masterId} is not registered on Tempo` })
    candidates.push('NO_MATCH')
  }

  // 3. Registry status.
  if (!p) {
    if (i.resolved.registered) {
      reasons.push({ code: 'unregistered', detail: 'No verified company is registered for this address' })
      candidates.push('NO_MATCH')
    }
  } else {
    if (p.revokedAt) { reasons.push({ code: 'revoked', detail: 'Verification revoked' }); candidates.push('REVOKED') }
    if (p.supersededAt) { reasons.push({ code: 'wallet_changed', detail: `${p.legalName} moved to ${p.successor}` }); candidates.push('CHANGED') }
    if (p.activeFrom > i.now) { reasons.push({ code: 'cooling_off', detail: `New wallet active from ${new Date(p.activeFrom * 1000).toISOString()}` }); candidates.push('CHANGED') }
    if (!p.revokedAt && !p.supersededAt) reasons.push({ code: 'verified', detail: `${p.legalName} · ${p.domain}${p.lei ? ' · LEI ' + p.lei : ''}` })

    const name = compareNames(i.payeeName, p.legalName)
    if (name.homoglyph) reasons.push({ code: 'homoglyph_name', detail: 'Invoice name uses look-alike characters' })
    if (name.result === 'MATCH') candidates.push('MATCH')
    if (name.result === 'CLOSE_MATCH') { reasons.push({ code: 'name_close', detail: `Registered name is "${p.legalName}"` }); candidates.push('CLOSE_MATCH') }
    if (name.result === 'NO_MATCH') { reasons.push({ code: 'name_mismatch', detail: `Registered name is "${p.legalName}"` }); candidates.push('NO_MATCH') }
  }

  // 4. Sender domain.
  if (i.senderDomain) {
    const d = normalizeDomain(i.senderDomain)
    const lookDomain = findLookalikeDomain(d, i.registeredDomains)
    if (lookDomain && (!p || getAddress(lookDomain.wallet) !== getAddress(p.wallet))) {
      reasons.push({ code: 'lookalike_domain', detail: `${d} imitates ${lookDomain.domain} (${lookDomain.label})` })
      if (!p) candidates.push('LOOKALIKE')
    } else if (p && d !== p.domain && !d.endsWith('.' + p.domain)) {
      reasons.push({ code: 'domain_mismatch', detail: `Invoice sent from ${d}; registered domain is ${p.domain}` })
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
