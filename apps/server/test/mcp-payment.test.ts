import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createDb, migrate } from '../src/db/client'
import { payees } from '../src/db/schema'
import { createApp, finalize } from '../src/app'
import { mountMcp } from '../src/mcp'

const ACME = '0xc1a53DA961B7A3A62db84Ae889f57fa818d3C426'
const LOOKALIKE = '0xC1A5d69D86Dea5CA36F7aE391b6610CfFB96C426'

function setup() {
  const db = createDb(':memory:'); migrate(db)
  db.insert(payees).values({ wallet: ACME, legalName: 'Acme Ltd', domain: 'acme.example', lei: '', masterId: '0x00000000', level: 1, activeFrom: 1, evidenceHash: '0x00', updatedBlock: 1 }).run()
  const ops = {
    resolveRecipient: vi.fn(async (to: any) => ({ effective: to, isVirtual: false, masterId: null, registered: true })),
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
const call = (c: Client, args: Record<string, unknown>) => c.callTool({ name: 'verify_payment_request', arguments: args })

describe('verify_payment_request MCP tool', () => {
  test('is listed as read-only', async () => {
    const c = await connect(setup().app)
    const tool = (await c.listTools()).tools.find((t) => t.name === 'verify_payment_request')
    expect(tool?.annotations?.readOnlyHint).toBe(true)
  })
  test('allows the verified wallet of the service domain', async () => {
    const { app, ops } = setup()
    const c = await connect(app)
    const r = textOf(await call(c, { recipient: ACME, domain: 'acme.example' }))
    expect(r).toMatchObject({ allow: true })
    expect(r.checks[0]).toMatchObject({ verdict: 'MATCH', recipient: { address: ACME, role: 'primary' } })
    expect(ops.readAllowlist).not.toHaveBeenCalled()
  })
  test('denies a lookalike recipient with the reason', async () => {
    const c = await connect(setup().app)
    const r = textOf(await call(c, { recipient: LOOKALIKE, domain: 'acme.example' }))
    expect(r.allow).toBe(false)
    expect(r.reason).toContain('LOOKALIKE')
  })
  test('a verified primary does not rescue an unverified split', async () => {
    const c = await connect(setup().app)
    const r = textOf(await call(c, { recipient: ACME, domain: 'acme.example', splits: [LOOKALIKE] }))
    expect(r.allow).toBe(false)
    expect(r.reason).toContain(LOOKALIKE)
  })
  test('a verification failure is a tool error that says not to pay', async () => {
    const { app, ops } = setup()
    ops.resolveRecipient.mockRejectedValueOnce(new Error('rpc down'))
    const c = await connect(app)
    const r: any = await call(c, { recipient: ACME, domain: 'acme.example' })
    expect(r.isError).toBe(true)
    expect(textOf(r).error).toMatch(/verification unavailable/)
    expect(textOf(r).error).not.toContain('rpc down')
  })
  test('an invalid recipient or split address is a tool error', async () => {
    const c = await connect(setup().app)
    expect(((await call(c, { recipient: 'nope', domain: 'acme.example' })) as any).isError).toBe(true)
    expect(((await call(c, { recipient: ACME, splits: ['0x123'] })) as any).isError).toBe(true)
    const badDomain: any = await call(c, { recipient: ACME, domain: 'https://' })
    expect(badDomain.isError).toBe(true)
    expect(textOf(badDomain).error).toBe('invalid domain')
  })
})
