import { describe, expect, test } from 'vitest'
import { decideAction } from '../src/policy'
import type { VerifyResult } from '../src/verdict'

const base: VerifyResult = {
  verdict: 'MATCH', payee: null, suggestedName: null, reasons: [],
  address: '0x' + '11'.repeat(20) as `0x${string}`, effectiveAddress: '0x' + '11'.repeat(20) as `0x${string}`,
  isVirtual: false, pinned: false, allowlisted: false,
}

describe('decideAction', () => {
  test.each([
    [{ verdict: 'MATCH', allowlisted: true }, 'PAY'],
    [{ verdict: 'MATCH', allowlisted: false }, 'ASK'],
    [{ verdict: 'NO_MATCH', allowlisted: true, pinned: true }, 'PAY'],
    [{ verdict: 'NO_MATCH', allowlisted: true, pinned: false }, 'ASK'],
    [{ verdict: 'CLOSE_MATCH', allowlisted: true, pinned: false }, 'ASK'],
    [{ verdict: 'CLOSE_MATCH', allowlisted: true, pinned: true }, 'PAY'],
    [{ verdict: 'LOOKALIKE', allowlisted: true, pinned: true }, 'BLOCK'],
    [{ verdict: 'CHANGED', allowlisted: true, pinned: true }, 'BLOCK'],
    [{ verdict: 'REVOKED', allowlisted: true, pinned: true }, 'BLOCK'],
  ] as const)('%o -> %s', (over, expected) => {
    expect(decideAction({ ...base, ...over })).toBe(expected)
  })
  test('unregistered virtual address is BLOCK', () => {
    expect(decideAction({ ...base, verdict: 'NO_MATCH', reasons: [{ code: 'unregistered_virtual', detail: '' }] })).toBe('BLOCK')
  })
  test('unregistered virtual is BLOCK even when allowlisted and pinned', () => {
    expect(decideAction({ ...base, verdict: 'NO_MATCH', allowlisted: true, pinned: true, reasons: [{ code: 'unregistered_virtual', detail: '' }] })).toBe('BLOCK')
  })
  test('pinned but not allowlisted is ASK', () => {
    expect(decideAction({ ...base, verdict: 'MATCH', pinned: true, allowlisted: false })).toBe('ASK')
  })
})
