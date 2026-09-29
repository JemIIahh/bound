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
