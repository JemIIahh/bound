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

/** Call after mounting every router: adds the JSON error handler (must be last). */
export function finalize(app: express.Express) {
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' })
    if (err?.name === 'ZodError') return res.status(400).json({ error: 'Invalid request', issues: err.issues })
    const status = typeof err?.status === 'number' ? err.status : 500
    res.status(status).json({ error: status < 500 ? err.message : 'Internal error' })
  })
  return app
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public expose = true) { super(message) }
}
