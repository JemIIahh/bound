import { describe, expect, test } from 'vitest'
import { hexToString, keccak256, stringToHex } from 'viem'
import { memoFromInvoice } from '../src/memo'
import { formatAmount, parseAmount } from '../src/amount'

describe('memoFromInvoice', () => {
  test('short refs are right-padded ASCII', () => {
    const m = memoFromInvoice('INV-1042')
    expect(m.length).toBe(66)
    expect(hexToString(m, { size: 32 }).replace(/\0+$/, '')).toBe('INV-1042')
  })
  test('long refs hash to 32 bytes', () => {
    const long = 'X'.repeat(40)
    expect(memoFromInvoice(long)).toBe(keccak256(stringToHex(long)))
  })
})

describe('parseAmount', () => {
  test.each([
    ['1250.50', 1_250_500_000n],
    ['1,250.50 USDC', 1_250_500_000n],
    ['USD 300', 300_000_000n],
    ['$0.000001', 1n],
    ['42', 42_000_000n],
  ])('%s', (raw, expected) => { expect(parseAmount(raw)).toBe(expected) })
  test.each(['', 'abc', '-5', '1.0000001', '1.2.3'])('rejects %s', (raw) => {
    expect(() => parseAmount(raw)).toThrow()
  })
  test('formatAmount round-trips', () => { expect(formatAmount(1_250_500_000n)).toBe('1250.5') })
})
