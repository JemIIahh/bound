import { describe, expect, test } from 'vitest'
import { AllowlistError, buildSetAllowlistCall, readAllowlist } from '../src/tempo/keychain'
import { TRANSFER_WITH_MEMO_SELECTOR } from '../src/tempo/constants'
import { PaymentOutcomeUnknown, PaymentRejected, payWithKey, preflightPay, agentAccount } from '../src/tempo/pay'

const token = '0x20c0000000000000000000000000000000000000' as const
const account = '0x3333333333333333333333333333333333333333'
const keyId = '0x1111111111111111111111111111111111111111'
const a = '0xCcB7f43C7D6DBbC4e545d8C01761098da5332ED2' as const
const OTHER_SELECTOR = '0xa9059cbb'

const mock = (result: unknown) => ({ readContract: async () => result })
const read = (result: unknown) => readAllowlist(mock(result), { account, keyId, token })
const scope = (rules: { selector: string; recipients: string[] }[], target: string = token) => ({ target, selectorRules: rules })

describe('readAllowlist fails closed', () => {
  test('(a) not scoped throws unrestricted', async () => {
    await expect(read([false, []])).rejects.toThrow(/^unrestricted:/)
    await expect(read([false, []])).rejects.toBeInstanceOf(AllowlistError)
  })
  test('(b) token scope with no selector rules throws', async () => {
    await expect(read([true, [scope([])]])).rejects.toThrow(/^unrestricted:/)
  })
  test('(c) transferWithMemo rule with empty recipients throws', async () => {
    await expect(read([true, [scope([{ selector: TRANSFER_WITH_MEMO_SELECTOR, recipients: [] }])]])).rejects.toThrow(/^unrestricted:/)
  })
  test('scope without a transferWithMemo rule returns []', async () => {
    expect(await read([true, [scope([{ selector: OTHER_SELECTOR, recipients: [a] }])]])).toEqual([])
  })
  test('scoped but no scope for this token returns []', async () => {
    expect(await read([true, [scope([{ selector: TRANSFER_WITH_MEMO_SELECTOR, recipients: [a] }], '0x20c0000000000000000000000000000000000001')]])).toEqual([])
  })
  test('normal case returns checksummed recipients', async () => {
    expect(await read([true, [scope([{ selector: TRANSFER_WITH_MEMO_SELECTOR, recipients: [a.toLowerCase()] }])]])).toEqual([a])
  })
})

describe('list hygiene', () => {
  test('dedupes and rejects zero address', () => {
    expect(() => buildSetAllowlistCall({ keyId, token, recipients: ['0x0000000000000000000000000000000000000000'] })).toThrow(AllowlistError)
    expect(() => buildSetAllowlistCall({ keyId, token, recipients: [a, a.toLowerCase() as any] })).not.toThrow()
  })
})

describe('non-Tempo clients are refused', () => {
  const acct = agentAccount(`0x${'11'.repeat(32)}`, a)
  const p = { account: acct, token, to: a, amount: 1n, memo: ('0x' + '00'.repeat(32)) as `0x${string}` }
  test('no chain throws', async () => {
    await expect(preflightPay({ estimateGas: async () => 1n }, p)).rejects.toThrow(/not a Tempo client/)
  })
  test('wrong chain throws', async () => {
    await expect(preflightPay({ chain: { id: 1 }, estimateGas: async () => 1n }, p)).rejects.toThrow(/not a Tempo client/)
  })
  test('tempo chain ok', async () => {
    expect(await preflightPay({ chain: { id: 42431 }, estimateGas: async () => 7n }, p)).toEqual({ ok: true, gas: 7n })
  })
})

describe('error classes', () => {
  test('PaymentOutcomeUnknown carries hash', () => {
    const e = new PaymentOutcomeUnknown('0xabc', new Error('502'))
    expect(e.txHash).toBe('0xabc')
    expect(e.message).toMatch(/502/)
  })
  test('PaymentRejected carries code', () => {
    expect(new PaymentRejected('CallNotAllowed', 'x').code).toBe('CallNotAllowed')
  })
  test('payWithKey signature exported', () => { expect(typeof payWithKey).toBe('function') })
})
