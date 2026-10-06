import { describe, expect, test, vi } from 'vitest'
import request from 'supertest'
import { eq } from 'drizzle-orm'
import { createDb, migrate } from '../src/db/client'
import { agentUsage, invoices, orgs } from '../src/db/schema'
import { createApp, finalize } from '../src/app'
import { sha256 } from '../src/crypto'
import { invoicesRouter } from '../src/routes/invoices'
import { labRouter } from '../src/routes/lab'
import { mountDemo } from '../src/routes/demo'
import { runAgent } from '../src/agent/run'
import { AGENT_BUSY, agentBudget, costMicroUsd, orgBusy } from '../src/services/agent-budget'
import { nowSeconds } from '../src/services/events'

const root = '0x3333333333333333333333333333333333333333'

function setup(config: Record<string, unknown> = {}) {
  const db = createDb(':memory:'); migrate(db)
  for (const id of ['org1', 'org2', 'public']) {
    db.insert(orgs).values({ id, name: id, rootAddress: root, agentKeyAddress: '0x' + '44'.repeat(20), agentKeyEnc: 'x', tokenHash: sha256(`tok-${id}`), limitBase: '1', periodSeconds: 1, authorized: 1, createdAt: 1 }).run()
  }
  const deps = {
    db, chain: { network: 'testnet' } as any, ops: {} as any,
    config: { webOrigin: '*', network: 'testnet', anthropicKey: 'k', demoOrgId: 'org1', demoPublicOrgId: 'public', demoRunsPerIpHour: 100, demoRunsPerDay: 100, agentRunsPerDay: 500, agentRunsPerOrgDay: 50, ...config } as any,
  } as any
  const run = vi.fn(async () => {})
  const app = createApp(deps)
  app.use('/v1', invoicesRouter(deps, run))
  app.use('/v1', labRouter(deps, run))
  mountDemo(app, deps, run)
  finalize(app)
  return { db, deps, app, run }
}

let seq = 0
/** n past runs (invoices) for an org, `ageSeconds` old. */
function pastRuns(db: ReturnType<typeof setup>['db'], orgId: string, n: number, ageSeconds = 60) {
  for (let i = 0; i < n; i++) db.insert(invoices).values({ id: `old${seq++}`, orgId, raw: 'x', lab: 0, createdAt: nowSeconds() - ageSeconds }).run()
}
const auth = (org = 'org1') => ({ authorization: `Bearer tok-${org}` })

describe('agentBudget', () => {
  test('allows runs under both caps', () => {
    const { db, deps } = setup({ agentRunsPerDay: 5, agentRunsPerOrgDay: 3 })
    pastRuns(db, 'org1', 2)
    expect(agentBudget(deps, 'org1')).toBeNull()
  })
  test('refuses an org at its daily cap, but not another org', () => {
    const { db, deps } = setup({ agentRunsPerDay: 100, agentRunsPerOrgDay: 3 })
    pastRuns(db, 'org1', 3)
    expect(agentBudget(deps, 'org1')).toBe(orgBusy(3))
    expect(agentBudget(deps, 'org2')).toBeNull()
  })
  test('refuses everyone at the overall daily cap, even with perOrg off', () => {
    const { db, deps } = setup({ agentRunsPerDay: 4, agentRunsPerOrgDay: 50 })
    pastRuns(db, 'org1', 2); pastRuns(db, 'org2', 2)
    expect(agentBudget(deps, 'public', { perOrg: false })).toBe(AGENT_BUSY)
  })
  test('runs older than a day no longer count', () => {
    const { db, deps } = setup({ agentRunsPerDay: 2, agentRunsPerOrgDay: 2 })
    pastRuns(db, 'org1', 5, 86_400 + 60)
    expect(agentBudget(deps, 'org1')).toBeNull()
  })
  test('a cap of 0 pauses new runs', () => {
    const { deps } = setup({ agentRunsPerDay: 0 })
    expect(agentBudget(deps, 'org1')).toBe(AGENT_BUSY)
  })
})

describe('caps on the routes that start the agent', () => {
  test('dashboard invoices: 429 at the org cap, nothing stored, agent not started', async () => {
    const { db, app, run } = setup({ agentRunsPerOrgDay: 2 })
    pastRuns(db, 'org1', 2)
    const res = await request(app).post('/v1/orgs/org1/invoices').set(auth()).send({ text: 'Invoice INV-9' })
    expect(res.status).toBe(429)
    expect(res.body.error).toBe(orgBusy(2))
    expect(db.select().from(invoices).all()).toHaveLength(2)
    expect(run).not.toHaveBeenCalled()
  })
  test('attack lab: 429 at the overall cap', async () => {
    const { db, app, run } = setup({ agentRunsPerDay: 1 })
    pastRuns(db, 'org2', 1)
    const res = await request(app).post('/v1/lab/org1/run').set(auth()).send({ text: 'scam', guardOff: true })
    expect(res.status).toBe(429)
    expect(res.body.error).toBe(AGENT_BUSY)
    expect(run).not.toHaveBeenCalled()
  })
  test('public demo: the overall cap makes it busy; the per-org cap does not apply to the public org', async () => {
    const full = setup({ agentRunsPerDay: 1 })
    pastRuns(full.db, 'org2', 1)
    expect((await request(full.app).get('/v1/demo')).body.status).toBe('busy')
    expect((await request(full.app).post('/v1/demo/runs').send({ text: 'scam', guardOff: false })).status).toBe(429)

    const roomy = setup({ agentRunsPerDay: 500, agentRunsPerOrgDay: 1 })
    pastRuns(roomy.db, 'public', 3)
    const res = await request(roomy.app).post('/v1/demo/runs').send({ text: 'scam', guardOff: false })
    expect(res.status).toBe(202)
    expect(roomy.run).toHaveBeenCalledTimes(1)
  })
})

describe('usage log', () => {
  const msg = (usage: any) => ({ role: 'assistant', content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn', usage })
  test('sums every model response of a run and stores an estimated cost', async () => {
    const { db, deps } = setup({ agentModel: 'claude-opus-5', agentPriceInPerMTok: 5, agentPriceOutPerMTok: 25 })
    db.insert(invoices).values({ id: 'inv1', orgId: 'org1', raw: 'Invoice', lab: 0, createdAt: nowSeconds() }).run()
    const client = { beta: { messages: { toolRunner: vi.fn(async function* () {
      yield msg({ input_tokens: 4000, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 1000 })
      yield msg({ input_tokens: 5000, output_tokens: 200, cache_read_input_tokens: 2000 })
    }) } } }
    await runAgent(deps, 'inv1', { mode: 'guarded' }, client as any)
    const u = db.select().from(agentUsage).where(eq(agentUsage.invoiceId, 'inv1')).get()!
    expect(u).toMatchObject({ orgId: 'org1', model: 'claude-opus-5', calls: 2, inputTokens: 9000, outputTokens: 500, cacheReadTokens: 2000, cacheWriteTokens: 1000 })
    // (9000 + 1.25×1000 + 0.1×2000) × $5 + 500 × $25 per million tokens = $0.06475
    expect(u.costMicroUsd).toBe(64_750)
  })
  test('a run whose model call failed before any response stores nothing', async () => {
    const { db, deps } = setup()
    db.insert(invoices).values({ id: 'inv2', orgId: 'org1', raw: 'Invoice', lab: 0, createdAt: nowSeconds() }).run()
    const client = { beta: { messages: { toolRunner: vi.fn(async function* () { throw new Error('401') }) } } }
    await runAgent(deps, 'inv2', { mode: 'guarded' }, client as any)
    expect(db.select().from(agentUsage).all()).toHaveLength(0)
  })
  test('costMicroUsd: tokens × price per million tokens', () => {
    expect(costMicroUsd({ calls: 1, input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 }, 5, 25)).toBe(5_000_000)
    expect(costMicroUsd({ calls: 1, input: 0, output: 1_000_000, cacheRead: 0, cacheWrite: 0 }, 5, 25)).toBe(25_000_000)
  })
})
