import { Router, type Express, type RequestHandler } from 'express'
import { z } from 'zod'
import { count, eq, gt } from 'drizzle-orm'
import { HttpError } from '../app'
import type { Config } from '../config'
import { newId } from '../crypto'
import { demoRuns, invoices, orgs } from '../db/schema'
import { HOUR, perIpLimit } from '../rate-limit'
import { nowSeconds } from '../services/events'
import type { ServiceDeps } from '../services/payments'
import { AGENT_ERROR_PREFIX, runAgent, type AgentLogEntry } from '../agent/run'
import { invoiceView, startAgent, type AgentRunner } from './invoices'
import { createLabInvoice, labAllowed, labMode } from './lab'
import { agentBudget } from '../services/agent-budget'

export const DEMO_MAX_TEXT_CHARS = 4000
export const DEMO_OFFLINE = 'The demo AI is offline right now.'
const DEMO_UNAVAILABLE = "The public demo isn't set up on this server."
const DEMO_BUSY = "The demo has used up today's runs. Try again tomorrow."
const DAY_SECONDS = 86_400
/** run_ + 16 random bytes (128 bits) in base64url: the only handle the public gets on a run. */
const RUN_ID = /^run_[A-Za-z0-9_-]{22}$/

const body = z.object({
  text: z.string().max(DEMO_MAX_TEXT_CHARS, `Keep the invoice under ${DEMO_MAX_TEXT_CHARS} characters`).refine((t) => t.trim() !== '', 'Write an invoice first'),
  guardOff: z.boolean(),
}).strict()

/**
 * The public demo needs the lab, and never runs on mainnet (not even with LAB_ENABLED): anyone can start
 * a run, and a guard-off run force-sends a transaction from the demo org's agent key.
 */
export const demoAllowed = (config: Pick<Config, 'network' | 'labEnabled'>) => labAllowed(config) && config.network === 'testnet'

type Status = { status: 'ready' | 'unavailable' | 'offline' | 'busy'; message: string | null }

/**
 * Whether a run could start now: the public demo org (DEMO_PUBLIC_ORG_ID, never the filmed DEMO_ORG_ID)
 * is configured and authorized, the agent has a key, and the daily cap has room.
 */
function demoStatus(deps: ServiceDeps): Status & { orgId?: string } {
  const { demoPublicOrgId: id, demoOrgId } = deps.config
  const org = id && id !== demoOrgId ? deps.db.select().from(orgs).where(eq(orgs.id, id)).get() : undefined
  if (!org?.authorized) return { status: 'unavailable', message: DEMO_UNAVAILABLE }
  if (!deps.config.anthropicKey) return { status: 'offline', message: DEMO_OFFLINE }
  const since = nowSeconds() - DAY_SECONDS
  const today = deps.db.select({ n: count() }).from(demoRuns).where(gt(demoRuns.createdAt, since)).get()?.n ?? 0
  if (today >= deps.config.demoRunsPerDay) return { status: 'busy', message: DEMO_BUSY }
  // the overall agent cap counts demo runs too; the per-org cap doesn't apply (DEMO_RUNS_PER_DAY is this org's cap)
  const busy = agentBudget(deps, org.id, { perOrg: false })
  if (busy) return { status: 'busy', message: busy }
  return { status: 'ready', message: null, orgId: org.id }
}

const isAgentError = (e: AgentLogEntry) => e.kind === 'text' && typeof e.data === 'string' && e.data.startsWith(AGENT_ERROR_PREFIX)

/** A run as the public sees it: only this run's own fields and log, never the org, its raw text or the model's error text. */
function runView(deps: ServiceDeps, run: typeof demoRuns.$inferSelect, inv: typeof invoices.$inferSelect) {
  const v = invoiceView(deps, inv)
  return {
    id: run.id,
    guardOff: run.guardOff === 1,
    status: v.status,
    // the model call failed (missing or rejected key, outage): the page says so instead of showing the error
    offline: v.agentLog.some(isAgentError),
    payeeName: v.payeeName, address: v.address, amountBase: v.amountBase, currency: v.currency, invoiceNo: v.invoiceNo,
    senderDomain: v.senderDomain, dueDate: v.dueDate, verdict: v.verdict, action: v.action, lab: v.lab, createdAt: v.createdAt,
    agentLog: v.agentLog.map((e) => (isAgentError(e) ? { ...e, data: DEMO_OFFLINE } : e)),
    payment: v.payment,
  }
}

export type DemoLimits = { flood?: RequestHandler; perIp?: RequestHandler }

/**
 * Public attack lab, no wallet or org token: runs the lab flow (createLabInvoice + startAgent) on the
 * public demo org (DEMO_PUBLIC_ORG_ID), whose credentials never leave the server. Abuse limits: a per-IP request
 * flood guard, DEMO_RUNS_PER_IP_HOUR runs per IP, DEMO_RUNS_PER_DAY runs per rolling day for everyone,
 * and a short invoice. Poll a run with GET /v1/demo/runs/:runId.
 */
export function demoRouter(deps: ServiceDeps, run: AgentRunner = runAgent, limits: DemoLimits = {}) {
  const r = Router()
  const { demoRunsPerIpHour: perHour } = deps.config
  const flood = limits.flood ?? perIpLimit(120, undefined, 'Too many requests. Slow down and try again in a minute.')
  const perIp = limits.perIp ?? perIpLimit(perHour, HOUR, `You've used this hour's ${perHour} demo runs. Try again a little later.`)

  r.get('/demo', flood, (_req, res) => {
    const { status, message } = demoStatus(deps)
    res.json({ status, message, runsPerHour: perHour, maxChars: DEMO_MAX_TEXT_CHARS })
  })

  // Refuses before validation when no run could start (nothing is spent), and validates before the per-IP
  // limit so a rejected body doesn't cost one of the hour's runs.
  const ready: RequestHandler = (req, res, next) => {
    const s = demoStatus(deps)
    if (s.status === 'unavailable' || s.status === 'offline') return void res.status(503).json({ error: s.message, code: s.status })
    if (s.status === 'busy') return void res.status(429).json({ error: s.message, code: s.status })
    res.locals.demo = { orgId: s.orgId!, ...body.parse(req.body) }
    next()
  }

  r.post('/demo/runs', flood, ready, perIp, (_req, res) => {
    const b: z.infer<typeof body> & { orgId: string } = res.locals.demo
    const invoiceId = createLabInvoice(deps, b.orgId, b.text)
    const id = newId('run', 16)
    deps.db.insert(demoRuns).values({ id, invoiceId, guardOff: b.guardOff ? 1 : 0, createdAt: nowSeconds() }).run()
    startAgent(deps, run, invoiceId, labMode(b.guardOff))
    res.status(202).json({ runId: id })
  })

  r.get('/demo/runs/:runId', flood, (req, res) => {
    const id = req.params.runId
    const row = typeof id === 'string' && RUN_ID.test(id) ? deps.db.select().from(demoRuns).where(eq(demoRuns.id, id)).get() : undefined
    const inv = row ? deps.db.select().from(invoices).where(eq(invoices.id, row.invoiceId)).get() : undefined
    if (!row || !inv) throw new HttpError(404, 'Run not found')
    res.json(runView(deps, row, inv))
  })

  return r
}

/** Mounts the public demo when the config allows it (testnet only). Returns whether it was mounted. */
export function mountDemo(app: Express, deps: ServiceDeps, run: AgentRunner = runAgent, limits?: DemoLimits): boolean {
  if (!demoAllowed(deps.config)) return false
  app.use('/v1', demoRouter(deps, run, limits))
  return true
}
