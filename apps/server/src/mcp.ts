import type express from 'express'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { getAddress, isAddress } from 'viem'
import { or, sql } from 'drizzle-orm'
import { payees } from './db/schema'
import { verifyPayee } from './services/verify-service'
import type { ServiceDeps } from './services/payments'

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
export function mountMcp(app: express.Express, deps: ServiceDeps) {
  app.post('/mcp', async (req, res) => {
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
