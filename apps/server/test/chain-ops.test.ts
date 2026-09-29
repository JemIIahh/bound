import { beforeEach, describe, expect, test, vi } from 'vitest'
import { generatePrivateKey } from 'viem/accounts'

vi.mock('@bound/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bound/core')>()
  return { ...actual, payWithKey: vi.fn(), forceSendWithKey: vi.fn() }
})

import { forceSendWithKey, payWithKey, PaymentOutcomeUnknown, PaymentRejected } from '@bound/core'
import { createDb, migrate } from '../src/db/client'
import { orgs } from '../src/db/schema'
import { encryptSecret } from '../src/crypto'
import { PaymentNotSent, productionChainOps } from '../src/services/payments'

const secret = ('0x' + '42'.repeat(32)) as `0x${string}`
const root = '0x3333333333333333333333333333333333333333'
const to = '0x5555555555555555555555555555555555555555'
const HASH = ('0x' + 'cd'.repeat(32)) as `0x${string}`
const pay = vi.mocked(payWithKey)
const forced = vi.mocked(forceSendWithKey)

function opsWith(pub: any = {}) {
  const db = createDb(':memory:'); migrate(db)
  db.insert(orgs).values({ id: 'o', name: 'x', rootAddress: root, agentKeyAddress: '0x' + '44'.repeat(20), agentKeyEnc: encryptSecret(generatePrivateKey(), secret), tokenHash: 'h', limitBase: '1', periodSeconds: 60, authorized: 1, createdAt: 1 }).run()
  return productionChainOps({ db, chain: { network: 'testnet', token: '0x20c0000000000000000000000000000000000000', pub } as any, config: { serverSecret: secret } as any })
}
const send = (ops: ReturnType<typeof opsWith>, force = false) => ops.send({ orgId: 'o', to, amount: 1n, memo: '0x00', force })

beforeEach(() => { pay.mockReset(); forced.mockReset() })

describe('production send', () => {
  test('success is success', async () => {
    pay.mockResolvedValueOnce({ txHash: HASH, receiptTxHash: HASH, status: 'success' })
    expect(await send(opsWith())).toEqual({ txHash: HASH, status: 'success' })
  })
  test('a reverted result is only called reverted once the receipt explicitly says so', async () => {
    pay.mockResolvedValueOnce({ txHash: HASH, receiptTxHash: HASH, status: 'reverted' })
    expect(await send(opsWith({ getTransactionReceipt: async () => ({ status: 'reverted' }) }))).toEqual({ txHash: HASH, status: 'reverted' })
  })
  test('a reverted result the receipt does not confirm is "maybe sent" (outcome unknown, with the hash)', async () => {
    pay.mockResolvedValueOnce({ txHash: HASH, receiptTxHash: HASH, status: 'reverted' })
    const err = await send(opsWith({ getTransactionReceipt: async () => { throw new Error('503') } })).catch((e) => e)
    expect(err).not.toBeInstanceOf(PaymentNotSent)
    expect(err.txHash).toBe(HASH)
  })
  test('PaymentRejected → not sent; PaymentOutcomeUnknown and unrecognised errors pass through as "maybe sent"', async () => {
    pay.mockRejectedValueOnce(new PaymentRejected('CallNotAllowed', 'x'))
    await expect(send(opsWith())).rejects.toBeInstanceOf(PaymentNotSent)
    const unknown = new PaymentOutcomeUnknown(HASH, new Error('502'))
    pay.mockRejectedValueOnce(unknown)
    await expect(send(opsWith())).rejects.toBe(unknown)
    const odd = new Error('socket hang up')
    pay.mockRejectedValueOnce(odd)
    await expect(send(opsWith())).rejects.toBe(odd)
  })
  test('force (lab guard-off) sends with no simulation via forceSendWithKey, never payWithKey', async () => {
    forced.mockResolvedValueOnce({ txHash: HASH, receiptTxHash: HASH, status: 'reverted' })
    const r = await send(opsWith({ getTransactionReceipt: async () => ({ status: 'reverted' }) }), true)
    expect(r).toEqual({ txHash: HASH, status: 'reverted' })
    expect(forced.mock.calls[0]![0]).toMatchObject({ to, amount: 1n })
    expect(pay).not.toHaveBeenCalled()
  })
  test('a forced send rejected before broadcast is "not sent"', async () => {
    forced.mockRejectedValueOnce(new PaymentRejected('Other', 'nonce fetch failed'))
    await expect(send(opsWith(), true)).rejects.toBeInstanceOf(PaymentNotSent)
  })
})
