import { describe, expect, test } from 'vitest'
import { decodeVirtual, findLookalike, isLookalikeAddress, isVirtualAddress } from '../src/address'

const v1 = '0x83196cf2fdfdfdfdfdfdfdfdfdfd000000000001'
const acme = '0xCcB7f43C7D6DBbC4e545d8C01761098da5332ED2'

describe('virtual addresses', () => {
  test('decodes masterId and userTag', () => {
    expect(decodeVirtual(v1)).toEqual({ masterId: '0x83196cf2', userTag: '0x000000000001' })
    expect(isVirtualAddress(v1)).toBe(true)
  })
  test('plain addresses are not virtual', () => {
    expect(decodeVirtual(acme)).toBeNull()
    expect(isVirtualAddress('0x1234')).toBe(false)
  })
})

describe('lookalike addresses', () => {
  test('same first/last 4 hex but different address is a lookalike', () => {
    const lookalike = '0xccb7' + '1'.repeat(32) + '2ed2'
    expect(isLookalikeAddress(lookalike, acme)).toBe(true)
  })
  test('identical address (any case) is not a lookalike', () => {
    expect(isLookalikeAddress(acme.toLowerCase(), acme)).toBe(false)
  })
  test('unrelated address is not a lookalike', () => {
    expect(isLookalikeAddress('0x' + 'ab'.repeat(20), acme)).toBe(false)
  })
  test('findLookalike returns the imitated known entry and honours exclude', () => {
    const lookalike = '0xccb7' + '1'.repeat(32) + '2ed2'
    const knowns = [{ wallet: acme, label: 'Acme Ltd' }]
    expect(findLookalike(lookalike, knowns)?.label).toBe('Acme Ltd')
    expect(findLookalike(lookalike, knowns, [acme])).toBeNull()
  })
})
