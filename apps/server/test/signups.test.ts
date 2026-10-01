import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import request from 'supertest'
import { createDb, migrate } from '../src/db/client'
import { signups } from '../src/db/schema'
import { createApp, finalize } from '../src/app'
import { signupsRouter } from '../src/routes/signups'
import { addSignup, signupCounts } from '../src/services/signups'

function setup(signupsPerIpHour = 10) {
  const db = createDb(':memory:'); migrate(db)
  const deps = { db, chain: { network: 'testnet' } as any, config: { webOrigin: '*', signupsPerIpHour } as any }
  const app = createApp(deps)
  app.use('/v1', signupsRouter(deps))
  finalize(app)
  return { db, app }
}

const post = (app: any, body: unknown, ip = '203.0.113.5') => request(app).post('/v1/signups').set('x-forwarded-for', ip).send(body as object)

describe('POST /v1/signups', () => {
  test('stores a trimmed, lower-cased email with its role and company', async () => {
    const { app, db } = setup()
    const res = await post(app, { email: '  Ada@Example.COM ', role: 'payer', company: ' Northwind ' })
    expect(res.status).toBe(201)
    expect(res.body).toEqual({ ok: true })
    expect(db.select().from(signups).all()).toEqual([{ email: 'ada@example.com', role: 'payer', company: 'Northwind', createdAt: expect.any(Number) }])
  })

  test('a duplicate (any case) gets the same answer and keeps the first entry', async () => {
    const { app, db } = setup()
    const first = await post(app, { email: 'ada@example.com', role: 'payer' })
    const again = await post(app, { email: 'ADA@example.com', role: 'builder', company: 'Other' })
    expect([again.status, again.body]).toEqual([first.status, first.body])
    expect(again.headers['content-length']).toBe(first.headers['content-length'])
    expect(db.select().from(signups).all()).toEqual([expect.objectContaining({ email: 'ada@example.com', role: 'payer', company: null })])
  })

  test('validates email, role and company', async () => {
    const { app, db } = setup(100)
    const bad = [
      {}, { role: 'payer' }, { email: 'ada@example.com' }, { email: 'not-an-email', role: 'payer' }, { email: 'ada@', role: 'payer' },
      { email: `${'a'.repeat(250)}@example.com`, role: 'payer' }, { email: 'ada@example.com', role: 'admin' },
      { email: 'ada@example.com', role: 'payer', company: 'x'.repeat(121) }, { email: 'ada@example.com', role: 'payer', extra: 1 },
      { email: ['ada@example.com'], role: 'payer' },
    ]
    for (const b of bad) {
      const res = await post(app, b)
      expect(res.status).toBe(400)
      expect(res.body.error).toBe('Invalid request')
    }
    expect(db.select().from(signups).all()).toHaveLength(0)
  })

  test('per-IP limit (SIGNUPS_PER_IP_HOUR)', async () => {
    const { app } = setup(3)
    for (let i = 0; i < 3; i++) expect((await post(app, { email: `u${i}@example.com`, role: 'other' })).status).toBe(201)
    const limited = await post(app, { email: 'u9@example.com', role: 'other' })
    expect(limited.status).toBe(429)
    expect(limited.body.error).toMatch(/Try again later/)
    expect((await post(app, { email: 'u9@example.com', role: 'other' }, '203.0.113.6')).status).toBe(201)
  })

  test('there is no listing endpoint', async () => {
    const { app } = setup()
    await post(app, { email: 'ada@example.com', role: 'payer' })
    expect((await request(app).get('/v1/signups')).status).toBe(404)
  })
})

describe('signup counts', () => {
  test('total and per role, every role present', () => {
    const db = createDb(':memory:'); migrate(db)
    for (const [email, role] of [['a@x.co', 'payer'], ['b@x.co', 'payer'], ['c@x.co', 'builder'], ['A@X.CO', 'other']] as const) addSignup(db, { email, role })
    expect(signupCounts(db)).toEqual({ total: 3, byRole: { payer: 2, supplier: 0, builder: 1, other: 0 } })
  })

  test('signups:count prints counts and no emails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bound-signups-'))
    try {
      const path = join(dir, 'test.db')
      const db = createDb(path); migrate(db)
      addSignup(db, { email: 'secret-person@example.com', role: 'supplier' })
      addSignup(db, { email: 'other@example.com', role: 'payer', company: 'Hidden Co' })
      ;(db as any).$client.close()
      const out = execFileSync('npx', ['tsx', 'scripts/signups-count.ts'], { cwd: fileURLToPath(new URL('..', import.meta.url)), env: { ...process.env, DATABASE_PATH: path }, encoding: 'utf8' })
      expect(out).toContain('Sign-ups: 2')
      expect(out).toMatch(/payer\s+1/)
      expect(out).toMatch(/supplier\s+1/)
      expect(out).not.toContain('@')
      expect(out).not.toContain('Hidden Co')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
