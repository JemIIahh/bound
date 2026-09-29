import { Router } from 'express'
import { z } from 'zod'
import { requireOrg } from '../auth'
import { newId } from '../crypto'
import { invoices } from '../db/schema'
import { nowSeconds } from '../services/events'
import type { ServiceDeps } from '../services/payments'
import { runAgent } from '../agent/run'
import { MAX_TEXT_CHARS, startAgent, type AgentRunner } from './invoices'

const body = z.object({
  text: z.string().max(MAX_TEXT_CHARS).refine((t) => t.trim() !== '', 'text is empty'),
  guardOff: z.boolean(),
})

/**
 * Attack lab: runs the agent on an attacker-written invoice. With guardOff, Bound's software checks
 * are skipped entirely (raw_transfer) so the demo shows Tempo's keychain refusing the payment onchain.
 * Poll the result with GET /v1/orgs/:orgId/invoices/:invoiceId.
 */
export function labRouter(deps: ServiceDeps, run: AgentRunner = runAgent) {
  const r = Router()
  r.post('/lab/:orgId/run', requireOrg(deps), (req, res) => {
    const b = body.parse(req.body)
    const id = newId('inv')
    deps.db.insert(invoices).values({ id, orgId: req.params.orgId, raw: b.text, lab: 1, createdAt: nowSeconds() }).run()
    startAgent(deps, run, id, b.guardOff ? 'guard_off' : 'guarded')
    res.status(202).json({ invoiceId: id })
  })
  return r
}
