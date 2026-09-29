import { describe, expect, test, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createDb, migrate } from '../src/db/client'
import { invoices, orgs } from '../src/db/schema'
import { runAgent } from '../src/agent/run'
import { GUARDED_SYSTEM, GUARD_OFF_SYSTEM } from '../src/agent/prompts'

const root = '0x3333333333333333333333333333333333333333'
const acme = '0xCcB7f43C7D6DBbC4e545d8C01761098da5332ED2'

function setup(lab = 0) {
  const db = createDb(':memory:'); migrate(db)
  db.insert(orgs).values({ id: 'org1', name: 'Buyer', rootAddress: root, agentKeyAddress: '0x' + '44'.repeat(20), agentKeyEnc: 'x', tokenHash: 'h', limitBase: '1', periodSeconds: 1, authorized: 1, createdAt: 1 }).run()
  db.insert(invoices).values({ id: 'inv1', orgId: 'org1', raw: 'Invoice INV-1 Acme Ltd', lab, createdAt: 1 }).run()
  const deps = { db, chain: { network: 'testnet' } as any, config: { anthropicKey: '' } as any, ops: {} as any } as any
  return { db, deps }
}

type Script = (params: any) => AsyncGenerator<any>
const fakeClient = (script: Script) => ({ beta: { messages: { toolRunner: vi.fn((params: any) => script(params)) } } })
const msg = (content: any[], stop_reason = 'end_turn') => ({ role: 'assistant', content, stop_reason })
const inv = (db: ReturnType<typeof setup>['db']) => db.select().from(invoices).where(eq(invoices.id, 'inv1')).get()!
const log = (db: ReturnType<typeof setup>['db']) => JSON.parse(inv(db).agentLog ?? '[]')

describe('runAgent', () => {
  test('calls the tool runner with the required model settings and the guarded tool set', async () => {
    const { deps } = setup()
    const client = fakeClient(async function* () { yield msg([{ type: 'text', text: 'done' }]) })
    await runAgent(deps, 'inv1', { mode: 'guarded' }, client as any)
    const params = client.beta.messages.toolRunner.mock.calls[0]![0]
    expect(params).toMatchObject({
      model: 'claude-opus-5-5', max_tokens: 16000, output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', system: GUARDED_SYSTEM,
    })
    expect(params.tool_choice).toBeUndefined()
    expect(params.tools.map((t: any) => t.name)).toEqual(['record_invoice_fields', 'verify_payee', 'pay_invoice', 'request_payee_approval', 'report_blocked'])
    expect(params.messages[0].content[0].text).toContain('<invoice>\nInvoice INV-1 Acme Ltd\n</invoice>')
  })

  test('logs tool calls, tool results and text in order', async () => {
    const { deps, db } = setup()
    const client = fakeClient(async function* (params) {
      const input = { payeeName: 'Acme Ltd', address: acme, amount: '10', currency: 'USDC', invoiceNo: 'INV-1' }
      yield msg([{ type: 'text', text: 'Recording.' }, { type: 'tool_use', id: 't1', name: 'record_invoice_fields', input }], 'tool_use')
      await params.tools.find((t: any) => t.name === 'record_invoice_fields').run(input) // what the runner does between turns
      yield msg([{ type: 'text', text: 'Blocked.' }])
    })
    db.update(invoices).set({ status: 'blocked' }).where(eq(invoices.id, 'inv1')).run() // keep the final status check out of this test
    await runAgent(deps, 'inv1', { mode: 'guarded' }, client as any)
    expect(log(db).map((e: any) => [e.kind, e.name ?? null])).toEqual([
      ['text', null], ['tool_call', 'record_invoice_fields'], ['tool_result', 'record_invoice_fields'], ['text', null],
    ])
    expect(log(db)[2].data).toMatchObject({ ok: false }) // blocked invoices are locked
  })

  test('a refusal is logged and the invoice fails without reading content', async () => {
    const { deps, db } = setup()
    const client = fakeClient(async function* () { yield { ...msg([{ type: 'text', text: 'partial' }], 'refusal'), stop_details: { type: 'refusal', category: 'cyber' } } })
    await runAgent(deps, 'inv1', { mode: 'guarded' }, client as any)
    expect(log(db)).toEqual([expect.objectContaining({ kind: 'text', data: expect.stringContaining('declined') })])
    expect(inv(db).status).toBe('failed')
  })

  test('an agent that stops without deciding leaves the invoice failed, not stuck processing', async () => {
    const { deps, db } = setup()
    const client = fakeClient(async function* () { yield msg([{ type: 'text', text: 'I am not sure.' }]) })
    await runAgent(deps, 'inv1', { mode: 'guarded' }, client as any)
    expect(inv(db).status).toBe('failed')
  })

  test('an API error is logged and fails the invoice', async () => {
    const { deps, db } = setup()
    const client = fakeClient(async function* () { throw new Error('401 invalid x-api-key') })
    await runAgent(deps, 'inv1', { mode: 'guarded' }, client as any)
    expect(inv(db).status).toBe('failed')
    expect(log(db).at(-1).data).toContain('Agent error')
  })

  test('guard-off mode only runs on lab invoices', async () => {
    const { deps, db } = setup(0)
    const client = fakeClient(async function* () { yield msg([]) })
    await runAgent(deps, 'inv1', { mode: 'guard_off' }, client as any)
    expect(client.beta.messages.toolRunner).not.toHaveBeenCalled()
    expect(inv(db).status).toBe('failed')

    const lab = setup(1)
    const c2 = fakeClient(async function* () { yield msg([]) })
    await runAgent(lab.deps, 'inv1', { mode: 'guard_off' }, c2 as any)
    const params = c2.beta.messages.toolRunner.mock.calls[0]![0]
    expect(params.system).toBe(GUARD_OFF_SYSTEM)
    expect(params.tools.map((t: any) => t.name)).toEqual(['record_invoice_fields', 'raw_transfer'])
  })
})
