import { describe, expect, test, vi } from 'vitest'
import { allowlistWith, createAuthorizedDemoOrg, DEMO_LIMIT_USD, DEMO_PERIOD_SECONDS } from '../scripts/lib'

const ROOT = '0x06dc65C749734F95534BA0102aA629974e8F7943'
const TX = '0x' + 'cd'.repeat(32)

describe('createAuthorizedDemoOrg (rehearse --fresh-org, demo:public-org)', () => {
  test('creates the org with the demo root and limits, the root signs the authorizeCall, the server confirms it', async () => {
    const authorizeCall = { to: '0x' + 'aa'.repeat(20), data: '0x1234' }
    const api = vi.fn(async (method: string, path: string) =>
      method === 'POST' && path === '/v1/orgs' ? { org: { id: 'org_new' }, token: 'secret-token', authorizeCall } : { authorized: true })
    const root = { account: { address: ROOT }, getChainId: vi.fn(async () => 42431), sendTransactionSync: vi.fn(async () => ({ transactionHash: TX })) }
    const out = await createAuthorizedDemoOrg(api as any, root as any, 'Northwind Trading (public demo)')
    expect(out).toEqual({ orgId: 'org_new', token: 'secret-token', authTx: TX })
    expect(api.mock.calls[0]).toEqual(['POST', '/v1/orgs', { name: 'Northwind Trading (public demo)', rootAddress: ROOT, limitUsd: DEMO_LIMIT_USD, periodSeconds: DEMO_PERIOD_SECONDS }])
    expect(root.sendTransactionSync).toHaveBeenCalledWith(expect.objectContaining({ ...authorizeCall, throwOnReceiptRevert: true }))
    expect(api.mock.calls[1]).toEqual(['POST', '/v1/orgs/org_new/authorized', { txHash: TX }, 'secret-token'])
    expect([DEMO_LIMIT_USD, DEMO_PERIOD_SECONDS]).toEqual(['50', 86_400])
  })

  test('sends nothing unless the RPC is Tempo testnet', async () => {
    const api = vi.fn()
    const root = { account: { address: ROOT }, getChainId: vi.fn(async () => 4217), sendTransactionSync: vi.fn() }
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`exit ${code}`) }) as any)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(createAuthorizedDemoOrg(api as any, root as any, 'x')).rejects.toThrow('exit 1')
    } finally {
      exit.mockRestore()
      err.mockRestore()
    }
    expect(api).not.toHaveBeenCalled()
    expect(root.sendTransactionSync).not.toHaveBeenCalled()
  })
})

describe('allowlistWith (demo:public-allow-acme)', () => {
  const ACME = '0xc1a53DA961B7A3A62db84Ae889f57fa818d3C426'
  const OTHER = '0x' + '77'.repeat(20)
  test('keeps the live list and the root sentinel and adds the payee; null when it is already allowed', () => {
    expect(allowlistWith([ROOT], ROOT, ACME)).toEqual([ROOT, ACME])
    expect(allowlistWith([ROOT, OTHER] as any, ROOT, ACME)).toEqual([ROOT, '0x7777777777777777777777777777777777777777', ACME])
    expect(allowlistWith([ROOT, ACME.toLowerCase()] as any, ROOT, ACME)).toBeNull()
  })
  test('restores a missing root sentinel and never produces an empty list', () => {
    expect(allowlistWith([], ROOT, ACME)).toEqual([ROOT, ACME])
    expect(allowlistWith([OTHER] as any, ROOT, ACME)).toEqual(['0x7777777777777777777777777777777777777777', ROOT, ACME])
  })
})
