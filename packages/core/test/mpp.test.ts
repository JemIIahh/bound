import { describe, expect, test } from 'vitest'
import { decidePayment, inspectChallenge, type RecipientCheck } from '../src/mpp'

const A = '0xc1a53DA961B7A3A62db84Ae889f57fa818d3C426'
const B = '0xC1A5d69D86Dea5CA36F7aE391b6610CfFB96C426'
const charge = (request: Record<string, unknown>, over: Partial<{ method: string; intent: string }> = {}) => ({ method: 'tempo', intent: 'charge', request, ...over })
const check = (address: string, verdict: RecipientCheck['verdict'], role: 'primary' | 'split' = 'primary', extra: Partial<RecipientCheck> = {}): RecipientCheck => ({
  recipient: { address: address as any, role, amount: '10000' }, verdict, action: null, payee: null, allowed: false, ...extra,
})

describe('inspectChallenge', () => {
  test('reads the primary recipient, checksummed', () => {
    const r = inspectChallenge(charge({ amount: '10000', currency: '0x20c0000000000000000000000000000000000000', recipient: A.toLowerCase() }))
    expect(r).toEqual({ ok: true, free: false, chainId: null, recipients: [{ address: A, role: 'primary', amount: '10000' }] })
  })
  test('reads every split recipient', () => {
    const r = inspectChallenge(charge({ amount: '10000', recipient: A, methodDetails: { chainId: 42431, splits: [{ recipient: B, amount: '1000' }] } }))
    expect(r).toMatchObject({ ok: true, chainId: 42431 })
    expect((r as any).recipients.map((x: any) => [x.address, x.role])).toEqual([[A, 'primary'], [B, 'split']])
  })
  test('amount 0 is free (identity proof): allowed, nothing to check', () => {
    expect(inspectChallenge(charge({ amount: '0', recipient: A }))).toEqual({ ok: true, free: true, chainId: null, recipients: [] })
  })
  test('a non-zero amount with no recipient cannot be verified', () => {
    expect(inspectChallenge(charge({ amount: '10000' }))).toMatchObject({ ok: false, reason: expect.stringContaining('recipient') })
  })
  test('a malformed recipient is refused', () => {
    expect(inspectChallenge(charge({ amount: '1', recipient: '0x123' }))).toMatchObject({ ok: false })
    expect(inspectChallenge(charge({ amount: '1', recipient: A, methodDetails: { splits: [{ recipient: 'nope', amount: '1' }] } }))).toMatchObject({ ok: false })
  })
  test('only tempo charge and session are supported', () => {
    expect(inspectChallenge(charge({ amount: '1', recipient: A }, { method: 'stripe' }))).toMatchObject({ ok: false, reason: expect.stringContaining('stripe') })
    expect(inspectChallenge(charge({ amount: '1', recipient: A }, { intent: 'subscription' }))).toMatchObject({ ok: false, reason: expect.stringContaining('subscription') })
    expect(inspectChallenge(charge({ amount: '1', recipient: A }, { intent: 'session' }))).toMatchObject({ ok: true })
  })
  test('a chain other than the expected one is refused', () => {
    expect(inspectChallenge(charge({ amount: '1', recipient: A, methodDetails: { chainId: 4217 } }), { expectedChainId: 42431 })).toMatchObject({ ok: false, reason: expect.stringContaining('4217') })
    expect(inspectChallenge(charge({ amount: '1', recipient: A, methodDetails: { chainId: 42431 } }), { expectedChainId: 42431 })).toMatchObject({ ok: true })
    // a chain id sent as a string must not slip past the check
    expect(inspectChallenge(charge({ amount: '1', recipient: A, methodDetails: { chainId: '4217' } }), { expectedChainId: 42431 })).toMatchObject({ ok: false })
  })
})

describe('decidePayment', () => {
  test('allows when every recipient is a MATCH', () => {
    expect(decidePayment([check(A, 'MATCH'), check(B, 'MATCH', 'split')])).toMatchObject({ allow: true })
  })
  test('denies a lookalike primary', () => {
    const d = decidePayment([check(B, 'LOOKALIKE')])
    expect(d.allow).toBe(false)
    expect(d.reason).toMatch(/LOOKALIKE/)
  })
  test('denies CHANGED and REVOKED', () => {
    expect(decidePayment([check(A, 'CHANGED')]).allow).toBe(false)
    expect(decidePayment([check(A, 'REVOKED')]).allow).toBe(false)
  })
  test('a verified primary does not rescue an unverified split (review focus 1)', () => {
    const d = decidePayment([check(A, 'MATCH'), check(B, 'NO_MATCH', 'split')])
    expect(d.allow).toBe(false)
    expect(d.reason).toContain(B)
  })
  test('NO_MATCH and CLOSE_MATCH follow onAsk (default block)', () => {
    expect(decidePayment([check(A, 'NO_MATCH')]).allow).toBe(false)
    expect(decidePayment([check(A, 'CLOSE_MATCH')]).allow).toBe(false)
    expect(decidePayment([check(A, 'NO_MATCH')], { onAsk: 'allow' }).allow).toBe(true)
  })
  test('onAsk allow never overrides a lookalike', () => {
    expect(decidePayment([check(B, 'LOOKALIKE')], { onAsk: 'allow' }).allow).toBe(false)
  })
  test('an explicitly allowed recipient passes without a verdict', () => {
    expect(decidePayment([check(B, null, 'split', { allowed: true })]).allow).toBe(true)
  })
  test('a failed check denies, with its error in the reason (review focus 3)', () => {
    const d = decidePayment([check(A, null, 'primary', { error: 'connect ECONNREFUSED' })])
    expect(d.allow).toBe(false)
    expect(d.reason).toMatch(/could not verify/i)
    expect(d.reason).toContain('ECONNREFUSED')
  })
  test('no checks at all denies (nothing proved the recipient)', () => {
    expect(decidePayment([]).allow).toBe(false)
  })
})
