import request from 'supertest'
import { describe, expect, test } from 'vitest'
import { corsOrigin, createApp } from '../src/app'
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

describe('corsOrigin (WEB_ORIGIN)', () => {
  test('a list, with spaces and trailing slashes, becomes exact origins', () => {
    expect(corsOrigin('http://localhost:3000, https://bound-livid.vercel.app/')).toEqual(['http://localhost:3000', 'https://bound-livid.vercel.app'])
  })
  test('* allows any origin; one origin stays one', () => {
    expect(corsOrigin('*')).toBe(true)
    expect(corsOrigin('https://example.com')).toEqual(['https://example.com'])
  })
  test('the API answers a listed site with that site only', async () => {
    const db = createDb(':memory:'); migrate(db)
    const app = createApp({ db, chain: { network: 'testnet' } as any, config: { webOrigin: 'http://localhost:3000,https://bound-livid.vercel.app/' } as any })
    const ok = await request(app).get('/health').set('origin', 'https://bound-livid.vercel.app')
    expect(ok.headers['access-control-allow-origin']).toBe('https://bound-livid.vercel.app')
    const other = await request(app).get('/health').set('origin', 'https://evil.example')
    expect(other.headers['access-control-allow-origin']).toBeUndefined()
  })
})
