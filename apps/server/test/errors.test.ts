import { expect, test } from 'vitest'
import request from 'supertest'
import { z } from 'zod'
import { createDb, migrate } from '../src/db/client'
import { createApp, finalize, HttpError } from '../src/app'

function appThrowing(err: () => unknown) {
  const db = createDb(':memory:'); migrate(db)
  const app = createApp({ db, chain: { network: 'testnet' } as any, config: { webOrigin: '*' } as any })
  app.get('/boom', () => { throw err() })
  app.post('/json', (req, res) => { res.json(req.body) })
  return finalize(app)
}

test('non-HttpError errors never expose their message or status (no RPC URL leakage)', async () => {
  const res = await request(appThrowing(() => ({ status: 429, message: 'https://rpc.example.com/v1/SECRETKEY rate limited' }))).get('/boom')
  expect([500, 502]).toContain(res.status)
  expect(JSON.stringify(res.body)).not.toContain('SECRETKEY')
  expect(JSON.stringify(res.body)).not.toContain('https://')
  const plain = await request(appThrowing(() => Object.assign(new Error('https://rpc.example.com/SECRETKEY'), { status: 400 }))).get('/boom')
  expect(plain.status).toBe(500)
  expect(plain.body).toEqual({ error: 'Internal error' })
})

test('viem HTTP request errors become 502 Upstream error without details', async () => {
  const err = () => Object.assign(new Error('HTTP request failed. URL: https://rpc.example.com/SECRETKEY'), { name: 'HttpRequestError', status: 429 })
  const res = await request(appThrowing(err)).get('/boom')
  expect(res.status).toBe(502)
  expect(res.body).toEqual({ error: 'Upstream error' })
  const wrapped = () => Object.assign(new Error('ContractFunctionExecutionError …'), { name: 'ContractFunctionExecutionError', cause: err() })
  expect((await request(appThrowing(wrapped)).get('/boom')).status).toBe(502)
})

test('HttpError, zod and JSON parse errors keep their status and message', async () => {
  const h = await request(appThrowing(() => new HttpError(409, 'Approval was rejected'))).get('/boom')
  expect(h.status).toBe(409)
  expect(h.body).toEqual({ error: 'Approval was rejected' })
  const five = await request(appThrowing(() => new HttpError(503, 'internal detail'))).get('/boom')
  expect(five.body).toEqual({ error: 'Internal error' })
  const zod = await request(appThrowing(() => { try { z.object({ a: z.string() }).parse({}) } catch (e) { return e } })).get('/boom')
  expect(zod.status).toBe(400)
  const bad = await request(appThrowing(() => null)).post('/json').set('content-type', 'application/json').send('{nope')
  expect(bad.status).toBe(400)
  expect(bad.body).toEqual({ error: 'Invalid JSON' })
})
