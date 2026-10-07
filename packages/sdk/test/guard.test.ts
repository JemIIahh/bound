import { describe, expect, test, vi } from 'vitest'
import { createGuardedFetch, PaymentBlockedError, type MppxLike } from '../src/guard'

const SERVICE = '0xc1a53DA961B7A3A62db84Ae889f57fa818d3C426'
const LOOKALIKE = '0xC1A5d69D86Dea5CA36F7aE391b6610CfFB96C426'
const verdictFor = (address: string, domain?: string) => {
  const ok = address.toLowerCase() === SERVICE.toLowerCase()
  return { verdict: ok ? 'MATCH' : 'LOOKALIKE', action: ok ? 'ASK' : 'BLOCK', payee: ok ? { legalName: 'Acme Ltd', domain: 'acme.example' } : null, reasons: [], domainSeen: domain } as any
}

function setup(request: Record<string, unknown>, o: { verify?: (i: any) => Promise<any>; method?: string; intent?: string } = {}) {
  const calls: string[] = []
  const createCredential = vi.fn(async () => 'cred')
  const mppx: MppxLike = {
    rawFetch: vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push(init?.headers && (init.headers as any).authorization ? 'paid' : 'first')
      return (init?.headers as any)?.authorization ? new Response('data', { status: 200 }) : new Response('pay', { status: 402 })
    }),
    preparePayment: vi.fn(async () => ({
      challenge: { method: o.method ?? 'tempo', intent: o.intent ?? 'charge', request },
      createCredential,
      setCredential: (init: RequestInit, c: string) => ({ ...init, headers: { ...(init.headers as object), authorization: c } }),
    })),
  }
  const bound = { verifyService: vi.fn(o.verify ?? (async (i: any) => verdictFor(i.address, i.domain))) }
  const decisions: any[] = []
  const guarded = createGuardedFetch({ bound, mppx, serviceDomain: 'acme.example', onDecision: (d) => decisions.push(d) })
  return { guarded, bound, mppx, createCredential, calls, decisions }
}

describe('createGuardedFetch', () => {
  test('a response that is not 402 passes straight through', async () => {
    const { guarded, mppx } = setup({ amount: '1', recipient: SERVICE })
    ;(mppx.rawFetch as any).mockResolvedValueOnce(new Response('free', { status: 200 }))
    expect((await guarded('https://api.example/x')).status).toBe(200)
    expect(mppx.preparePayment).not.toHaveBeenCalled()
  })
  test('pays when the recipient is the verified wallet for the service domain', async () => {
    const { guarded, bound, createCredential, calls } = setup({ amount: '10000', recipient: SERVICE.toLowerCase() })
    const res = await guarded('https://api.example/data')
    expect(res.status).toBe(200)
    expect(bound.verifyService).toHaveBeenCalledWith({ address: SERVICE, domain: 'acme.example' })
    expect(createCredential).toHaveBeenCalledTimes(1)
    expect(calls).toEqual(['first', 'paid'])
  })
  test('uses the URL host when no serviceDomain is given', async () => {
    const { mppx, bound } = setup({ amount: '1', recipient: SERVICE })
    const guarded = createGuardedFetch({ bound, mppx })
    await guarded('https://data.acme.example/v1/quote')
    expect(bound.verifyService).toHaveBeenCalledWith({ address: SERVICE, domain: 'data.acme.example' })
  })
  test('a hijacked recipient is blocked before anything is signed (review focus 6)', async () => {
    const { guarded, createCredential, calls, decisions } = setup({ amount: '10000', recipient: LOOKALIKE })
    await expect(guarded('https://api.example/data')).rejects.toBeInstanceOf(PaymentBlockedError)
    expect(createCredential).not.toHaveBeenCalled()
    expect(calls).toEqual(['first'])
    expect(decisions[0]).toMatchObject({ allow: false, url: 'https://api.example/data' })
  })
  test('the error carries the decision and a readable message', async () => {
    const { guarded } = setup({ amount: '1', recipient: LOOKALIKE })
    const err: PaymentBlockedError = await guarded('https://api.example/d').catch((e) => e)
    expect(err.message).toMatch(/blocked/i)
    expect(err.message).toMatch(/LOOKALIKE/)
    expect(err.decision.checks[0]?.verdict).toBe('LOOKALIKE')
  })
  test('a verified primary with an unverified split is blocked (review focus 1)', async () => {
    const { guarded, createCredential } = setup({ amount: '10000', recipient: SERVICE, methodDetails: { splits: [{ recipient: LOOKALIKE, amount: '500' }] } })
    await expect(guarded('https://api.example/d')).rejects.toBeInstanceOf(PaymentBlockedError)
    expect(createCredential).not.toHaveBeenCalled()
  })
  test('a split is checked without a domain; allowRecipients skips the check (case-insensitive)', async () => {
    const { mppx, bound } = setup({ amount: '10000', recipient: SERVICE, methodDetails: { splits: [{ recipient: LOOKALIKE, amount: '500' }] } })
    const guarded = createGuardedFetch({ bound, mppx, serviceDomain: 'acme.example', allowRecipients: [LOOKALIKE.toLowerCase()] })
    expect((await guarded('https://api.example/d')).status).toBe(200)
    expect(bound.verifyService).toHaveBeenCalledTimes(1) // only the primary
  })
  test('a failing Bound API blocks, never pays (review focus 3)', async () => {
    const { guarded, createCredential } = setup({ amount: '1', recipient: SERVICE }, { verify: async () => { throw new Error('ECONNREFUSED') } })
    const err: PaymentBlockedError = await guarded('https://api.example/d').catch((e) => e)
    expect(err).toBeInstanceOf(PaymentBlockedError)
    expect(err.decision.reason).toMatch(/could not verify/i)
    expect(createCredential).not.toHaveBeenCalled()
  })
  test('unsupported methods and intents are blocked (review focus 4)', async () => {
    for (const o of [{ method: 'stripe' }, { intent: 'subscription' }]) {
      const { guarded, createCredential } = setup({ amount: '1', recipient: SERVICE }, o)
      await expect(guarded('https://api.example/d')).rejects.toBeInstanceOf(PaymentBlockedError)
      expect(createCredential).not.toHaveBeenCalled()
    }
  })
  test('a free identity challenge (amount 0) signs without any Bound call', async () => {
    const { guarded, bound, createCredential } = setup({ amount: '0', recipient: SERVICE })
    expect((await guarded('https://api.example/d')).status).toBe(200)
    expect(bound.verifyService).not.toHaveBeenCalled()
    expect(createCredential).toHaveBeenCalledTimes(1)
  })
  test('a chain mismatch is blocked', async () => {
    const { mppx, bound, createCredential } = setup({ amount: '1', recipient: SERVICE, methodDetails: { chainId: 4217 } })
    const guarded = createGuardedFetch({ bound, mppx, serviceDomain: 'acme.example', expectedChainId: 42431 })
    await expect(guarded('https://api.example/d')).rejects.toBeInstanceOf(PaymentBlockedError)
    expect(createCredential).not.toHaveBeenCalled()
  })
})
