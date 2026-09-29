import { Router } from 'express'
import { getAddress, isAddress, type Hex } from 'viem'
import { z } from 'zod'
import { requireOrg } from '../auth'
import { confirmApproval, prepareApproval, rejectApproval } from '../services/approvals'
import { authorizeDemo, confirmAuthorization, createOrg, getOverview } from '../services/orgs'
import type { ServiceDeps } from '../services/payments'
import { perIpLimit } from '../rate-limit'

const ZERO = '0x0000000000000000000000000000000000000000'

const createBody = z.object({
  name: z.string().trim().min(1).max(120),
  rootAddress: z.string().refine((a) => isAddress(a) && a.toLowerCase() !== ZERO, 'Invalid root address'),
  limitUsd: z.string().trim().min(1).max(40),
  periodSeconds: z.number().int().positive().max(10 * 365 * 86400),
})
const txBody = z.object({ txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'Invalid transaction hash') })

export function orgsRouter(deps: ServiceDeps) {
  const r = Router()
  const auth = requireOrg(deps)
  // public, unauthenticated creation and the server-signed demo authorization: 5 per minute per IP each
  const createLimit = perIpLimit(5)
  const demoLimit = perIpLimit(5)

  r.post('/orgs', createLimit, async (req, res) => {
    const b = createBody.parse(req.body)
    res.status(201).json(await createOrg(deps, { ...b, rootAddress: getAddress(b.rootAddress) }))
  })

  r.post('/orgs/:orgId/authorized', auth, async (req, res) => {
    const { txHash } = txBody.parse(req.body)
    res.json(await confirmAuthorization(deps, req.params.orgId, txHash as Hex))
  })

  r.post('/orgs/:orgId/authorize-demo', auth, demoLimit, async (_req, res) => {
    const orgId: string = res.locals.org.id // set by requireOrg
    res.json(await authorizeDemo(deps, orgId))
  })

  r.get('/orgs/:orgId/overview', auth, async (req, res) => {
    res.json(await getOverview(deps, req.params.orgId))
  })

  r.post('/orgs/:orgId/approvals/:id/prepare', auth, async (req, res) => {
    res.json(await prepareApproval(deps, req.params.orgId, req.params.id))
  })

  r.post('/orgs/:orgId/approvals/:id/confirm', auth, async (req, res) => {
    const { txHash } = txBody.parse(req.body)
    res.json(await confirmApproval(deps, req.params.orgId, req.params.id, txHash as Hex))
  })

  r.post('/orgs/:orgId/approvals/:id/reject', auth, async (req, res) => {
    res.json(await rejectApproval(deps, req.params.orgId, req.params.id))
  })

  return r
}
