import { Router } from 'express'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { txUrl } from '@bound/core'
import { HttpError } from '../app'
import { requireOrg } from '../auth'
import { newId } from '../crypto'
import { invoices, payments } from '../db/schema'
import { nowSeconds } from '../services/events'
import type { ServiceDeps } from '../services/payments'
import { isPdfBase64, runAgent } from '../agent/run'

export type AgentRunner = typeof runAgent

export const MAX_PDF_BYTES = 8 * 1024 * 1024
export const MAX_TEXT_CHARS = 100_000

const body = z.object({
  text: z.string().max(MAX_TEXT_CHARS).optional(),
  pdfBase64: z.string().max(Math.ceil(MAX_PDF_BYTES / 3) * 4 + 1024).optional(),
})

/** Validates an invoice body and returns what is stored in `invoices.raw`: the text, or `pdf:<base64>`. */
export function invoiceRaw(input: unknown): string {
  const b = body.parse(input)
  const hasText = b.text !== undefined && b.text.trim() !== ''
  const hasPdf = b.pdfBase64 !== undefined && b.pdfBase64 !== ''
  if (hasText === hasPdf) throw new HttpError(400, 'Send exactly one of text or pdfBase64')
  if (hasText) return b.text!
  const b64 = b.pdfBase64!.replace(/\s+/g, '')
  if (!isPdfBase64(b64)) throw new HttpError(400, 'pdfBase64 must be a base64-encoded PDF')
  if (Buffer.byteLength(b64, 'base64') > MAX_PDF_BYTES) throw new HttpError(400, 'PDF is larger than 8 MB')
  return `pdf:${b64}`
}

/** Starts the agent without awaiting it; the invoice row (status + agentLog) carries the outcome. */
export function startAgent(deps: ServiceDeps, run: AgentRunner, invoiceId: string, mode: 'guarded' | 'guard_off') {
  void run(deps, invoiceId, { mode }).catch((e) => console.error('[agent] run failed', invoiceId, e))
}

const parseJson = (s: string | null) => {
  if (!s) return null
  try { return JSON.parse(s) } catch { return null }
}

export function invoicesRouter(deps: ServiceDeps, run: AgentRunner = runAgent) {
  const r = Router()
  const auth = requireOrg(deps)

  r.post('/orgs/:orgId/invoices', auth, (req, res) => {
    const raw = invoiceRaw(req.body)
    const id = newId('inv')
    deps.db.insert(invoices).values({ id, orgId: req.params.orgId, raw, lab: 0, createdAt: nowSeconds() }).run()
    startAgent(deps, run, id, 'guarded')
    res.status(202).json({ invoiceId: id })
  })

  r.get('/orgs/:orgId/invoices/:invoiceId', auth, (req, res) => {
    const inv = deps.db.select().from(invoices).where(and(eq(invoices.id, req.params.invoiceId), eq(invoices.orgId, req.params.orgId))).get()
    if (!inv) throw new HttpError(404, 'Invoice not found')
    const pay = deps.db.select().from(payments).where(eq(payments.invoiceId, inv.id)).get()
    const { verdictJson, agentLog, raw, ...rest } = inv
    res.json({
      ...rest,
      raw: raw.startsWith('pdf:') && isPdfBase64(raw.slice(4)) ? '[pdf]' : raw,
      verdict: parseJson(verdictJson),
      agentLog: parseJson(agentLog) ?? [],
      payment: pay
        ? { status: pay.status, toAddress: pay.toAddress, amountBase: pay.amountBase, txHash: pay.txHash, txUrl: pay.txHash ? txUrl(deps.chain.network, pay.txHash as `0x${string}`) : null }
        : null,
    })
  })

  return r
}
