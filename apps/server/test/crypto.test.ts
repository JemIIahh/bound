import { expect, test } from 'vitest'
import { decryptSecret, encryptSecret } from '../src/crypto'
const secret = ('0x' + '42'.repeat(32)) as `0x${string}`
test('round-trips and is non-deterministic', () => {
  const a = encryptSecret('0xdeadbeef', secret)
  const b = encryptSecret('0xdeadbeef', secret)
  expect(a).not.toBe(b)
  expect(decryptSecret(a, secret)).toBe('0xdeadbeef')
})
test('tampering fails', () => {
  const a = encryptSecret('hello', secret)
  const parts = a.split('.')
  parts[2] = Buffer.from('tampered').toString('base64')
  expect(() => decryptSecret(parts.join('.'), secret)).toThrow()
})
