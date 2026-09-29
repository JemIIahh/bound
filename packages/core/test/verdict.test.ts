import { describe, expect, test } from 'vitest'
import { decideAction } from '../src/policy'
import { evaluate, type VerifyInput } from '../src/verdict'
import type { OnchainPayee } from '../src/bound-registry'

const NOW = 1_800_000_000
const acmeWallet = '0xCcB7f43C7D6DBbC4e545d8C01761098da5332ED2'
const lookalike = ('0xccb7' + '1'.repeat(32) + '2ed2') as `0x${string}`

const acme: OnchainPayee = {
  wallet: acmeWallet, legalName: 'Acme Ltd', domain: 'acme.com', lei: '', masterId: '0x83196cf2', level: 1,
  verifiedAt: NOW - 1000, activeFrom: NOW - 1000, supersededAt: 0, revokedAt: 0, successor: null, evidenceHash: '0x' + '0'.repeat(64) as `0x${string}`,
}

function input(over: Partial<VerifyInput> = {}): VerifyInput {
  return {
    address: acmeWallet, payeeName: 'Acme Ltd', now: NOW,
    resolved: { effective: acmeWallet, isVirtual: false, masterId: null, registered: true },
    payee: acme,
    knownWallets: [{ wallet: acmeWallet, label: 'Acme Ltd', source: 'registry' }],
    registeredDomains: [{ domain: 'acme.com', label: 'Acme Ltd', wallet: acmeWallet }],
    pinned: false, allowlisted: false,
    ...over,
  }
}

describe('evaluate', () => {
  test('verified payee with matching name is MATCH', () => {
    const r = evaluate(input())
    expect(r.verdict).toBe('MATCH')
    expect(r.payee?.legalName).toBe('Acme Ltd')
    expect(r.reasons.map((x) => x.code)).toContain('verified')
  })
  test('close name is CLOSE_MATCH with a suggestion', () => {
    const r = evaluate(input({ payeeName: 'Acme Holdings' }))
    expect(r.verdict).toBe('CLOSE_MATCH')
    expect(r.suggestedName).toBe('Acme Ltd')
  })
  test('different name is NO_MATCH', () => {
    expect(evaluate(input({ payeeName: 'Globex' })).verdict).toBe('NO_MATCH')
  })
  test('unregistered wallet is NO_MATCH with reason unregistered', () => {
    const other = '0x' + 'ab'.repeat(20) as `0x${string}`
    const r = evaluate(input({ payeeName: 'Globex', address: other, resolved: { effective: other, isVirtual: false, masterId: null, registered: true }, payee: null }))
    expect(r.verdict).toBe('NO_MATCH')
    expect(r.reasons.map((x) => x.code)).toContain('unregistered')
  })
  test('lookalike of a known wallet is LOOKALIKE even if the name matches', () => {
    const r = evaluate(input({ address: lookalike, resolved: { effective: lookalike, isVirtual: false, masterId: null, registered: true }, payee: null }))
    expect(r.verdict).toBe('LOOKALIKE')
    expect(r.reasons.find((x) => x.code === 'lookalike_address')?.detail).toContain('Acme Ltd')
  })
  test('unregistered wallet from a lookalike domain is LOOKALIKE', () => {
    const other = '0x' + 'ab'.repeat(20) as `0x${string}`
    const r = evaluate(input({ address: other, resolved: { effective: other, isVirtual: false, masterId: null, registered: true }, payee: null, senderDomain: 'acme-ltd.co' }))
    expect(r.verdict).toBe('LOOKALIKE')
  })
  test('verified payee invoiced from another domain keeps MATCH with domain_mismatch reason', () => {
    const r = evaluate(input({ senderDomain: 'quickbooks.com' }))
    expect(r.verdict).toBe('MATCH')
    expect(r.reasons.map((x) => x.code)).toContain('domain_mismatch')
  })
  test('superseded wallet is CHANGED', () => {
    const r = evaluate(input({ payee: { ...acme, supersededAt: NOW - 10, successor: '0x' + '22'.repeat(20) as `0x${string}` } }))
    expect(r.verdict).toBe('CHANGED')
  })
  test('new wallet inside cooling-off is CHANGED', () => {
    const r = evaluate(input({ payee: { ...acme, activeFrom: NOW + 3600 } }))
    expect(r.verdict).toBe('CHANGED')
    expect(r.reasons.map((x) => x.code)).toContain('cooling_off')
  })
  test('revoked payee is REVOKED', () => {
    expect(evaluate(input({ payee: { ...acme, revokedAt: NOW - 5 } })).verdict).toBe('REVOKED')
  })
  test('unregistered virtual address is NO_MATCH with unregistered_virtual', () => {
    const v = '0xdeadbeeffdfdfdfdfdfdfdfdfdfd000000000001' as `0x${string}`
    const r = evaluate(input({ payeeName: 'Globex', address: v, resolved: { effective: v, isVirtual: true, masterId: '0xdeadbeef', registered: false }, payee: null }))
    expect(r.verdict).toBe('NO_MATCH')
    expect(r.reasons.map((x) => x.code)).toContain('unregistered_virtual')
  })
  test('a verified payee virtual address resolving to the known wallet is not a lookalike', () => {
    const v = '0x83196cf2fdfdfdfdfdfdfdfdfdfd000000000001' as `0x${string}`
    const r = evaluate(input({ address: v, resolved: { effective: acmeWallet, isVirtual: true, masterId: '0x83196cf2', registered: true } }))
    expect(r.verdict).toBe('MATCH')
  })
  test('homoglyph name never MATCHes', () => {
    const r = evaluate(input({ payeeName: 'Асme Ltd' }))
    expect(r.verdict).toBe('CLOSE_MATCH')
    expect(r.reasons.map((x) => x.code)).toContain('homoglyph_name')
  })
  test('LOOKALIKE outranks CHANGED', () => {
    const r = evaluate(input({ address: lookalike, resolved: { effective: lookalike, isVirtual: false, masterId: null, registered: true }, payee: { ...acme, wallet: lookalike, supersededAt: NOW - 1 } }))
    expect(r.verdict).toBe('LOOKALIKE')
  })

  const other = ('0x' + 'ab'.repeat(20)) as `0x${string}`
  const unreg = (over: Partial<VerifyInput> = {}) =>
    input({ address: other, resolved: { effective: other, isVirtual: false, masterId: null, registered: true }, payee: null, ...over })

  test('guard: payee record for another address throws', () => {
    expect(() => evaluate(unreg({ payee: acme }))).toThrow('payee record does not belong')
  })
  test('guard: now in milliseconds throws', () => {
    expect(() => evaluate(input({ now: 1_800_000_000_000 }))).toThrow('unix seconds')
  })
  test('a1: unregistered wallet claiming a verified company via name+domain is LOOKALIKE', () => {
    const r = evaluate(unreg({ senderDomain: 'billing@acme.com' }))
    expect(r.verdict).toBe('LOOKALIKE')
    expect(r.reasons.map((x) => x.code)).toContain('claims_verified_payee')
  })
  test('a2: pinned+allowlisted impersonator is BLOCK', () => {
    const r = evaluate(unreg({ senderDomain: 'billing@acme.com', pinned: true, allowlisted: true }))
    expect(decideAction(r)).toBe('BLOCK')
  })
  test('a3: homoglyph name on unregistered pinned wallet is LOOKALIKE', () => {
    const r = evaluate(unreg({ payeeName: 'Асme Ltd', pinned: true }))
    expect(r.verdict).toBe('LOOKALIKE')
    expect(r.reasons.map((x) => x.code)).toContain('homoglyph_name')
  })
  test('a4: unrelated name on unregistered wallet stays NO_MATCH', () => {
    const r = evaluate(unreg({ payeeName: 'Globex' }))
    expect(r.verdict).toBe('NO_MATCH')
    expect(r.reasons.map((x) => x.code)).toEqual(['unregistered'])
  })
  test('unregistered non-virtual address always gets unregistered reason', () => {
    const r = evaluate(unreg({ payeeName: 'Globex' }))
    expect(r.reasons.map((x) => x.code)).toContain('unregistered')
  })
  test('lookalike address with its own payee record and matching name is LOOKALIKE', () => {
    const r = evaluate(input({ address: lookalike, resolved: { effective: lookalike, isVirtual: false, masterId: null, registered: true }, payee: { ...acme, wallet: lookalike } }))
    expect(r.verdict).toBe('LOOKALIKE')
  })
  test('lookalike sender domain records lookalike_domain reason', () => {
    const r = evaluate(unreg({ senderDomain: 'acme-ltd.co' }))
    expect(r.verdict).toBe('LOOKALIKE')
    expect(r.reasons.map((x) => x.code)).toContain('lookalike_domain')
  })
  test('subdomain sender keeps MATCH without domain_mismatch', () => {
    const r = evaluate(input({ senderDomain: 'mail.acme.com' }))
    expect(r.verdict).toBe('MATCH')
    expect(r.reasons.map((x) => x.code)).not.toContain('domain_mismatch')
  })
  test('exact domain with a similar registered domain gives no lookalike_domain', () => {
    const r = evaluate(input({
      senderDomain: 'acme.com',
      registeredDomains: [{ domain: 'acme.com', label: 'Acme Ltd', wallet: acmeWallet }, { domain: 'acne.com', label: 'Acne Inc', wallet: other }],
    }))
    expect(r.verdict).toBe('MATCH')
    expect(r.reasons.map((x) => x.code)).not.toContain('lookalike_domain')
  })
  test('lookalike of a different company domain downgrades MATCH to CLOSE_MATCH', () => {
    const r = evaluate(input({
      senderDomain: 'acne.co',
      registeredDomains: [{ domain: 'acme.com', label: 'Acme Ltd', wallet: acmeWallet }, { domain: 'acne.com', label: 'Acne Inc', wallet: other }],
    }))
    expect(r.reasons.map((x) => x.code)).toContain('lookalike_domain')
    expect(r.verdict).toBe('CLOSE_MATCH')
  })
  test('superseded without successor has clean detail and no verified reason', () => {
    const r = evaluate(input({ payee: { ...acme, supersededAt: NOW - 10, successor: null } }))
    const changed = r.reasons.find((x) => x.code === 'wallet_changed')!
    expect(changed.detail).toBe('Wallet superseded')
    expect(r.reasons.map((x) => x.code)).not.toContain('verified')
  })
  test('no verified reason when revoked or cooling-off', () => {
    expect(evaluate(input({ payee: { ...acme, revokedAt: NOW - 5 } })).reasons.map((x) => x.code)).not.toContain('verified')
    expect(evaluate(input({ payee: { ...acme, activeFrom: NOW + 60 } })).reasons.map((x) => x.code)).not.toContain('verified')
  })
  test('superseded and revoked pinned+allowlisted wallets are BLOCK end to end', () => {
    const flags = { pinned: true, allowlisted: true }
    expect(decideAction(evaluate(input({ ...flags, payee: { ...acme, supersededAt: NOW - 10, successor: other } })))).toBe('BLOCK')
    expect(decideAction(evaluate(input({ ...flags, payee: { ...acme, revokedAt: NOW - 5 } })))).toBe('BLOCK')
  })
})
