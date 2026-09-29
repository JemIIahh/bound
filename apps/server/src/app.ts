import express from 'express'
import cors from 'cors'
import type { Db } from './db/client'
import type { Chain } from './chain'
import type { Config } from './config'

export type AppDeps = { db: Db; chain: Chain; config: Config }

export function createApp(deps: AppDeps) {
  const app = express()
  app.use(cors({ origin: deps.config.webOrigin === '*' ? true : deps.config.webOrigin }))
  app.use(express.json({ limit: '12mb' }))
  app.get('/health', (_req, res) => { res.json({ ok: true, network: deps.chain.network }) })
  return app
}

/** viem transport failures (walks `cause`, matched by name since core and server may hold different viem copies). */
const UPSTREAM_ERRORS = new Set(['HttpRequestError', 'RpcRequestError', 'TimeoutError', 'WebSocketRequestError', 'WaitForTransactionReceiptTimeoutError'])
function isUpstreamError(err: unknown): boolean {
  let cur: any = err
  for (let depth = 0; cur && depth < 8; depth++, cur = cur.cause) if (UPSTREAM_ERRORS.has(cur?.name)) return true
  return false
}

/**
 * Call after mounting every router: adds the JSON error handler (must be last). Only HttpError (and
 * request-parsing/validation errors) expose a status and message; anything else, e.g. an RPC error
 * whose message can carry a provider URL/key, becomes a generic 500 (or 502 for upstream failures).
 */
export function finalize(app: express.Express) {
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' })
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Payload too large' })
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid request', issues: err.issues })
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.status < 500 ? err.message : 'Internal error' })
    console.error('[http]', err)
    if (isUpstreamError(err)) return res.status(502).json({ error: 'Upstream error' })
    res.status(500).json({ error: 'Internal error' })
  })
  return app
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public expose = true) { super(message) }
}
