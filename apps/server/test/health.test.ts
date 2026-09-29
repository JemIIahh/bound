import request from 'supertest'
import { expect, test } from 'vitest'
import { createApp } from '../src/app'
import { createDb, migrate } from '../src/db/client'
test('GET /health', async () => {
  const db = createDb(':memory:'); migrate(db)
  const app = createApp({ db, chain: { network: 'testnet' } as any, config: { webOrigin: '*' } as any })
  const res = await request(app).get('/health')
  expect(res.status).toBe(200)
  expect(res.body).toEqual({ ok: true, network: 'testnet' })
})

test('trusts exactly one proxy hop for req.ip (per-IP rate limits behind Railway)', async () => {
  const db = createDb(':memory:'); migrate(db)
  const app = createApp({ db, chain: { network: 'testnet' } as any, config: { webOrigin: '*' } as any })
  app.get('/ip', (req, res) => { res.json({ ip: req.ip }) })
  // a client-supplied X-Forwarded-For entry is not trusted: only the hop the proxy appended is
  const res = await request(app).get('/ip').set('x-forwarded-for', '6.6.6.6, 203.0.113.7')
  expect(res.body.ip).toBe('203.0.113.7')
})
