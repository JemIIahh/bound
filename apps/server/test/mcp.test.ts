import { afterEach, describe, expect, test, vi } from 'vitest'
import request from 'supertest'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createDb, migrate } from '../src/db/client'
import { payees } from '../src/db/schema'
import { createApp, finalize } from '../src/app'
import { mountMcp } from '../src/mcp'

const acme = '0xCcB7f43C7D6DBbC4e545d8C01761098da5332ED2'
const attacker = '0x7777777777777777777777777777777777777777'

function setup() {
  const db = createDb(':memory:'); migrate(db)
  db.insert(payees).values({ wallet: acme, legalName: 'Acme Ltd', domain: 'acme.com', lei: '', masterId: '0x00000000', level: 1, activeFrom: 1, evidenceHash: '0x00', updatedBlock: 1 }).run()
  const ops = {
    resolveRecipient: vi.fn(async (to: any) => ({ effective: to, isVirtual: false, masterId: null, registered: false })),
    readPayee: vi.fn(async () => null),
    readAllowlist: vi.fn(),
  }
  const deps = { db, chain: { network: 'testnet' } as any, config: { webOrigin: '*' } as any, ops } as any
  const app = createApp(deps); mountMcp(app, deps); finalize(app)
  return { app, ops }
}

let server: Server | undefined
let client: Client | undefined
afterEach(async () => {
  await client?.close().catch(() => {})
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()))
  client = undefined; server = undefined
})

async function connect(app: ReturnType<typeof setup>['app']) {
  server = await new Promise<Server>((r) => { const s = app.listen(0, () => r(s)) })
  const { port } = server.address() as AddressInfo
  client = new Client({ name: 'bound-test', version: '0.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)))
  return client
}

const textOf = (r: any) => JSON.parse(r.content[0].text)

describe('public MCP endpoint', () => {
  test('MCP lists verify_payee and lookup_payee', async () => {
    const { app } = setup()
    const res = await request(app).post('/mcp')
      .set('accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    expect(res.status).toBe(200)
    const text = res.text
    expect(text).toContain('verify_payee')
    expect(text).toContain('lookup_payee')
  })

  test('an MCP client sees exactly the two public read-only tools', async () => {
    const c = await connect(setup().app)
    const { tools } = await c.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(['lookup_payee', 'verify_payee'])
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true)
  })

  test('verify_payee returns the verdict with reasons and never consults an org', async () => {
    const { app, ops } = setup()
    const c = await connect(app)
    const r = textOf(await c.callTool({ name: 'verify_payee', arguments: { address: attacker, payeeName: 'Acme Ltd', senderDomain: 'billing@acme.com' } }))
    expect(r.verdict).toBe('LOOKALIKE')
    expect(r.reasons.map((x: any) => x.code)).toContain('claims_verified_payee')
    expect(ops.readAllowlist).not.toHaveBeenCalled()
    const ok = textOf(await c.callTool({ name: 'verify_payee', arguments: { address: acme, payeeName: 'Acme Ltd' } }))
    expect(ok.verdict).toBe('MATCH')
  })

  test('verify_payee rejects an invalid address as a tool error', async () => {
    const c = await connect(setup().app)
    const r: any = await c.callTool({ name: 'verify_payee', arguments: { address: 'nope', payeeName: 'Acme Ltd' } })
    expect(r.isError).toBe(true)
  })

  test('lookup_payee searches by name or domain and treats LIKE wildcards literally', async () => {
    const c = await connect(setup().app)
    expect(textOf(await c.callTool({ name: 'lookup_payee', arguments: { query: 'acme' } })).payees.map((p: any) => p.wallet)).toEqual([acme])
    expect(textOf(await c.callTool({ name: 'lookup_payee', arguments: { query: 'ACME.COM' } })).payees).toHaveLength(1)
    expect(textOf(await c.callTool({ name: 'lookup_payee', arguments: { query: '%' } })).payees).toHaveLength(0)
  })
})
