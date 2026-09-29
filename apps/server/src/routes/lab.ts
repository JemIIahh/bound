import { Router, type Express, type RequestHandler } from 'express'
import { z } from 'zod'
import { requireOrg } from '../auth'
import type { Config } from '../config'
import { newId } from '../crypto'
import { invoices } from '../db/schema'
import { perOrgLimit } from '../rate-limit'
import { nowSeconds } from '../services/events'
import type { ServiceDeps } from '../services/payments'
import { runAgent } from '../agent/run'
import { MAX_TEXT_CHARS, startAgent, type AgentRunner } from './invoices'

const body = z.object({
  text: z.string().max(MAX_TEXT_CHARS).refine((t) => t.trim() !== '', 'text is empty'),
  guardOff: z.boolean(),
})

/** The attack lab is always available on testnet; on mainnet only with LAB_ENABLED=true. */
export const labAllowed = (config: Pick<Config, 'network' | 'labEnabled'>) => config.network === 'testnet' || config.labEnabled === true

/**
 * Attack lab: runs the agent on an attacker-written invoice. With guardOff, Bound's payee checks are
 * skipped (raw_transfer) so the demo shows Tempo's keychain refusing the payment onchain.
 * Poll the result with GET /v1/orgs/:orgId/invoices/:invoiceId.
 */
export function labRouter(deps: ServiceDeps, run: AgentRunner = runAgent, limit: RequestHandler = perOrgLimit(10)) {
  const r = Router()
  r.post('/lab/:orgId/run', requireOrg(deps), limit, (req, res) => {
    const b = body.parse(req.body)
    const id = newId('inv')
    const orgId: string = res.locals.org.id // set by requireOrg
    deps.db.insert(invoices).values({ id, orgId, raw: b.text, lab: 1, createdAt: nowSeconds() }).run()
    startAgent(deps, run, id, b.guardOff ? 'guard_off' : 'guarded')
    res.status(202).json({ invoiceId: id })
  })
  return r
}

/** Mounts the lab router when the network/config allows it. Returns whether it was mounted. */
export function mountLab(app: Express, deps: ServiceDeps, run: AgentRunner = runAgent): boolean {
  if (!labAllowed(deps.config)) return false
  app.use('/v1', labRouter(deps, run))
  return true
}
