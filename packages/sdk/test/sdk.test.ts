import { expect, test, vi } from 'vitest'
import { BoundClient } from '../src/index'
test('verifyPayee posts JSON and returns the body', async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ verdict: 'MATCH', action: 'PAY' }), { status: 200 }))
  const c = new BoundClient({ baseUrl: 'https://api.example', fetch: fetch as any })
  const r = await c.verifyPayee({ address: '0x' + '11'.repeat(20), payeeName: 'Acme' })
  expect(r.verdict).toBe('MATCH')
  expect(fetch).toHaveBeenCalledWith('https://api.example/v1/verify', expect.objectContaining({ method: 'POST' }))
})
test('non-2xx throws with the server error', async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ error: 'bad' }), { status: 400 }))
  const c = new BoundClient({ baseUrl: 'https://api.example', fetch: fetch as any })
  await expect(c.verifyPayee({ address: 'x', payeeName: 'y' })).rejects.toThrow('bad')
})
test('getPayee returns null on 404 but rethrows other errors', async () => {
  const f404 = vi.fn(async () => new Response('{}', { status: 404 }))
  expect(await new BoundClient({ baseUrl: 'https://a', fetch: f404 as any }).getPayee('0x1')).toBeNull()
  const f500 = vi.fn(async () => new Response(JSON.stringify({ error: 'boom' }), { status: 500 }))
  await expect(new BoundClient({ baseUrl: 'https://a', fetch: f500 as any }).getPayee('0x1')).rejects.toThrow('boom')
})
test('sends bearer token when configured', async () => {
  const fetch = vi.fn(async (_u: string, _i: any) => new Response('{}', { status: 200 }))
  await new BoundClient({ baseUrl: 'https://a/', token: 't', fetch: fetch as any }).verifyPayee({ address: 'x', payeeName: 'y' })
  const [url, init] = fetch.mock.calls[0]!
  expect(url).toBe('https://a/v1/verify')
  expect(init.headers.authorization).toBe('Bearer t')
})
