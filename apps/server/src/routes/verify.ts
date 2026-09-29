import { Router, type RequestHandler } from 'express'
import { getAddress, isAddress } from 'viem'
import { z } from 'zod'
import type { ServiceDeps } from '../services/payments'
import { verifyPayee } from '../services/verify-service'
import { perIpLimit } from '../rate-limit'

const body = z.object({
  address: z.string().refine((a) => isAddress(a), 'Invalid address'),
  payeeName: z.string().trim().min(1).max(300),
  senderDomain: z.string().trim().max(320).optional(),
})

/** Public Confirmation-of-Payee check. Never org-scoped, so no pins or allowlist are consulted. */
export function verifyRouter(deps: ServiceDeps, limit: RequestHandler = perIpLimit(60)) {
  const r = Router()
  r.post('/verify', limit, async (req, res) => {
    const b = body.parse(req.body)
    res.json(await verifyPayee(deps, { address: getAddress(b.address), payeeName: b.payeeName, senderDomain: b.senderDomain || undefined }))
  })
  return r
}
