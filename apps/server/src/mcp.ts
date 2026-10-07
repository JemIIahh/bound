import type express from 'express'
import type { RequestHandler } from 'express'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { getAddress, isAddress } from 'viem'
import { or, sql } from 'drizzle-orm'
import { decidePayment, type RecipientCheck } from '@bound/core'
import { HttpError } from './app'
import { payees } from './db/schema'
import { verifyPayee, verifyService } from './services/verify-service'
import type { ServiceDeps } from './services/payments'
import { perIpLimit } from './rate-limit'

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const

const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`
const json = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })
const toolError = (message: string) => ({ ...json({ error: message }), isError: true })

type PayeeRow = typeof payees.$inferSelect
const status = (p: PayeeRow, now: number) =>
  p.revokedAt ? 'revoked' : p.supersededAt ? 'superseded' : p.activeFrom > now ? 'cooling_off' : 'active'

/**
 * The public MCP server: read-only Confirmation of Payee. It never takes an org, so no org-scoped
 * data (pins, allowlists, invoices) and no payment capability is reachable through it.
 */
function buildServer(deps: ServiceDeps) {
  const server = new McpServer({ name: 'bound', version: '0.1.0' })
  server.registerTool('verify_payee', {
    description: 'Confirmation of Payee for Tempo stablecoin payments: who controls this address, and does the name match? Returns MATCH, CLOSE_MATCH, NO_MATCH, LOOKALIKE, CHANGED or REVOKED with reasons.',
    inputSchema: {
      address: z.string().max(100).describe('Payment address (0x…)'),
      payeeName: z.string().min(1).max(300).describe('Payee name as written on the invoice'),
      senderDomain: z.string().max(320).optional().describe('Domain (or email address) the invoice was sent from'),
    },
    annotations: READ_ONLY,
  }, async ({ address, payeeName, senderDomain }) => {
    if (!isAddress(address.trim())) return toolError('invalid address')
    try {
      return json(await verifyPayee(deps, { address: getAddress(address.trim()), payeeName, senderDomain: senderDomain || undefined }))
    } catch (e) {
      console.error('[mcp] verify_payee failed', e)
      return toolError('verification unavailable; treat this payee as unverified')
    }
  })
  server.registerTool('verify_payment_request', {
    description: 'Before an AI agent pays an MPP (HTTP 402) request: is the recipient the verified wallet of the service it means to pay? Pass the 402 challenge\'s recipient, the service domain, and any split recipients. Returns allow true/false with the reason; never pay when allow is false.',
    inputSchema: {
      recipient: z.string().max(100).describe('The challenge\'s primary recipient address (0x…)'),
      domain: z.string().max(253).optional().describe('The service domain the agent means to pay, e.g. api.acme.com'),
      splits: z.array(z.string().max(100)).max(10).optional().describe('Split recipient addresses from the challenge, if any'),
    },
    annotations: READ_ONLY,
  }, async ({ recipient, domain, splits }) => {
    const all = [recipient, ...(splits ?? [])]
    if (!all.every((a) => isAddress(a.trim()))) return toolError('invalid address')
    try {
      // the primary is checked against the service domain; splits only need to be active Bound-verified wallets
      const checks: RecipientCheck[] = []
      for (const [i, raw] of all.entries()) {
        const address = getAddress(raw.trim())
        const r = await verifyService(deps, { address, domain: i === 0 ? domain || undefined : undefined })
        checks.push({ recipient: { address, role: i === 0 ? 'primary' : 'split', amount: '' }, verdict: r.verdict, action: r.action, payee: r.payee ? { legalName: r.payee.legalName, domain: r.payee.domain } : null, allowed: false })
      }
      return json(decidePayment(checks))
    } catch (e) {
      if (e instanceof HttpError && e.status === 400) return toolError('invalid domain')
      console.error('[mcp] verify_payment_request failed', e)
      return toolError('verification unavailable; do not pay this request')
    }
  })
  server.registerTool('lookup_payee', {
    description: 'Search Bound-verified companies by name or domain.',
    inputSchema: { query: z.string().trim().min(1).max(100).describe('Company name or domain fragment') },
    annotations: READ_ONLY,
  }, async ({ query }) => {
    const q = likePattern(query)
    const now = Math.floor(Date.now() / 1000)
    const rows = deps.db.select().from(payees)
      .where(or(sql`${payees.legalName} LIKE ${q} ESCAPE '\\'`, sql`${payees.domain} LIKE ${q} ESCAPE '\\'`))
      .orderBy(payees.legalName).limit(10).all()
    return json({
      payees: rows.map((p) => ({
        wallet: p.wallet, legalName: p.legalName, domain: p.domain, lei: p.lei || null, level: p.level,
        status: status(p, now), successor: p.successor,
      })),
    })
  })
  return server
}

/** Stateless MCP over streamable HTTP: a fresh server + transport per request. */
export function mountMcp(app: express.Express, deps: ServiceDeps, limit: RequestHandler = perIpLimit(60)) {
  app.post('/mcp', limit, async (req, res) => {
    const server = buildServer(deps)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on('close', () => { void transport.close(); void server.close() })
    try {
      await server.connect(transport)
      await transport.handleRequest(req, res, req.body)
    } catch (e) {
      console.error('[mcp] request failed', e)
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null })
    }
  })
  // Stateless: no server-initiated streams and no sessions to delete.
  const notAllowed = (_req: express.Request, res: express.Response) => {
    res.status(405).set('allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null })
  }
  app.get('/mcp', notAllowed)
  app.delete('/mcp', notAllowed)
}
