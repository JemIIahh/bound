import { Router, type Express, type RequestHandler } from 'express'
import { z } from 'zod'
import { requireOrg } from '../auth'
import type { Config } from '../config'
import { newId } from '../crypto'
import { invoices } from '../db/schema'
import { perOrgLimit } from '../rate-limit'
import { HttpError } from '../app'
import { agentBudget } from '../services/agent-budget'
import { nowSeconds } from '../services/events'
import type { ServiceDeps } from '../services/payments'
import { runAgent } from '../agent/run'
import type { AgentMode } from '../agent/tools'
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
    const busy = agentBudget(deps, res.locals.org.id) // org set by requireOrg
    if (busy) throw new HttpError(429, busy)
    const id = createLabInvoice(deps, res.locals.org.id, b.text)
    startAgent(deps, run, id, labMode(b.guardOff))
    res.status(202).json({ invoiceId: id })
  })
  return r
}

/** Stores an attack-lab invoice (lab = 1) for the org; start the agent on it with startAgent(…, labMode(guardOff)). */
export function createLabInvoice(deps: Pick<ServiceDeps, 'db'>, orgId: string, text: string): string {
  const id = newId('inv')
  deps.db.insert(invoices).values({ id, orgId, raw: text, lab: 1, createdAt: nowSeconds() }).run()
  return id
}

export const labMode = (guardOff: boolean): AgentMode => (guardOff ? 'guard_off' : 'guarded')

/** Mounts the lab router when the network/config allows it. Returns whether it was mounted. */
export function mountLab(app: Express, deps: ServiceDeps, run: AgentRunner = runAgent): boolean {
  if (!labAllowed(deps.config)) return false
  app.use('/v1', labRouter(deps, run))
  return true
}
