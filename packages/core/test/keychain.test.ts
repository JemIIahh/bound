import { describe, expect, test } from 'vitest'
import { decodeFunctionData } from 'viem'
import { Abis } from 'viem/tempo'
import { AllowlistError, buildAuthorizeKeyCall, buildSetAllowlistCall, withRecipient, withoutRecipient } from '../src/tempo/keychain'
import { KEYCHAIN, MAX_RECIPIENTS, TRANSFER_WITH_MEMO_SELECTOR } from '../src/tempo/constants'
import { decodeTempoError } from '../src/tempo/errors'

const token = '0x20c0000000000000000000000000000000000000'
const keyId = '0x1111111111111111111111111111111111111111'
const a = '0xCcB7f43C7D6DBbC4e545d8C01761098da5332ED2'
const b = '0x2222222222222222222222222222222222222222'

describe('allowlist list ops', () => {
  test('withRecipient dedupes case-insensitively and checksums', () => {
    expect(withRecipient([a], a.toLowerCase() as any)).toEqual([a])
    expect(withRecipient([a], b)).toEqual([a, b])
  })
  test('withoutRecipient refuses to empty the list', () => {
    expect(() => withoutRecipient([a], a)).toThrow(AllowlistError)
    expect(withoutRecipient([a, b], a)).toEqual([b])
  })
  test('withRecipient refuses past the cap', () => {
    const many = Array.from({ length: MAX_RECIPIENTS }, (_, i) => `0x${(i + 1).toString(16).padStart(40, '0')}` as const)
    expect(() => withRecipient(many, b)).toThrow(/57/)
  })
})

describe('call builders', () => {
  test('setAllowedCalls encodes one scope for transferWithMemo', () => {
    const call = buildSetAllowlistCall({ keyId, token, recipients: [a, b] })
    expect(call.to).toBe(KEYCHAIN)
    const d = decodeFunctionData({ abi: Abis.accountKeychain, data: call.data })
    expect(d.functionName).toBe('setAllowedCalls')
    const scopes = (d.args as any)[1]
    expect(scopes[0].target.toLowerCase()).toBe(token)
    expect(scopes[0].selectorRules[0].selector).toBe(TRANSFER_WITH_MEMO_SELECTOR)
    expect(scopes[0].selectorRules[0].recipients).toEqual([a, b])
  })
  test('builders reject an empty recipient list', () => {
    expect(() => buildSetAllowlistCall({ keyId, token, recipients: [] })).toThrow(AllowlistError)
    expect(() => buildAuthorizeKeyCall({ keyId, token, limit: 1n, periodSeconds: 3600n, expiry: 9999999999n, recipients: [] })).toThrow(AllowlistError)
  })
  test('authorizeKey enforces limits and disallows any-call', () => {
    const call = buildAuthorizeKeyCall({ keyId, token, limit: 500_000_000n, periodSeconds: 604800n, expiry: 1893456000n, recipients: [a] })
    const d = decodeFunctionData({ abi: Abis.accountKeychain, data: call.data })
    expect(d.functionName).toBe('authorizeKey')
    const cfg = (d.args as any)[2]
    expect(cfg.enforceLimits).toBe(true)
    expect(cfg.allowAnyCalls).toBe(false)
    expect(cfg.limits[0].amount).toBe(500_000_000n)
  })
})

describe('decodeTempoError', () => {
  test('recognises keychain errors from message or data', () => {
    expect(decodeTempoError({ shortMessage: 'Execution reverted with reason: Account keychain error: CallNotAllowed(CallNotAllowed).' }).code).toBe('CallNotAllowed')
    expect(decodeTempoError({ cause: { data: '0x8a9e71ea' } }).code).toBe('SpendingLimitExceeded')
    expect(decodeTempoError({ details: 'reverted 0xda56842c' }).code).toBe('VirtualAddressUnregistered')
    expect(decodeTempoError(new Error('boom')).code).toBe('Other')
  })
})
