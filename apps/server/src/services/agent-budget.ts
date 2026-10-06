import { and, count, eq, gt } from 'drizzle-orm'
import { agentUsage, invoices } from '../db/schema'
import { nowSeconds } from './events'
import type { ServiceDeps } from './payments'

const DAY_SECONDS = 86_400
export const AGENT_BUSY = "Bound's AI agent has used today's runs. Try again tomorrow."
export const orgBusy = (n: number) => `This organization has used today's ${n} agent runs. Try again tomorrow.`

/**
 * The agent's daily spend caps: every agent run is one invoice, so the invoices created in the last rolling day
 * are the runs. Returns the refusal message, or null when a run may start. `perOrg: false` skips the per-org cap
 * (the public demo org has its own, DEMO_RUNS_PER_DAY); the overall cap always applies.
 */
export function agentBudget(deps: Pick<ServiceDeps, 'db' | 'config'>, orgId: string, opts: { perOrg?: boolean } = {}): string | null {
  const since = nowSeconds() - DAY_SECONDS
  const all = deps.db.select({ n: count() }).from(invoices).where(gt(invoices.createdAt, since)).get()?.n ?? 0
  if (all >= deps.config.agentRunsPerDay) return AGENT_BUSY
  if (opts.perOrg === false) return null
  const mine = deps.db.select({ n: count() }).from(invoices).where(and(eq(invoices.orgId, orgId), gt(invoices.createdAt, since))).get()?.n ?? 0
  return mine >= deps.config.agentRunsPerOrgDay ? orgBusy(deps.config.agentRunsPerOrgDay) : null
}

export type Usage = { calls: number; input: number; output: number; cacheRead: number; cacheWrite: number }
export const emptyUsage = (): Usage => ({ calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })

/** Adds one model response's usage (the API's `usage` object; any field may be missing through a gateway). */
export function addUsage(u: Usage, r: { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } | null | undefined) {
  if (!r) return
  u.calls += 1
  u.input += r.input_tokens ?? 0
  u.output += r.output_tokens ?? 0
  u.cacheRead += r.cache_read_input_tokens ?? 0
  u.cacheWrite += r.cache_creation_input_tokens ?? 0
}

/** Estimated cost in micro-USD: prices are per million tokens, so tokens × price is micro-USD. Cache writes bill at 1.25× input, reads at 0.1×. */
export const costMicroUsd = (u: Usage, inPerMTok: number, outPerMTok: number) =>
  Math.round((u.input + 1.25 * u.cacheWrite + 0.1 * u.cacheRead) * inPerMTok + u.output * outPerMTok)

/** Stores (or replaces) the usage row for one agent run. */
export function recordUsage(deps: Pick<ServiceDeps, 'db' | 'config'>, invoiceId: string, orgId: string, model: string, u: Usage) {
  const row = {
    invoiceId, orgId, model, calls: u.calls, inputTokens: u.input, outputTokens: u.output, cacheReadTokens: u.cacheRead, cacheWriteTokens: u.cacheWrite,
    costMicroUsd: costMicroUsd(u, deps.config.agentPriceInPerMTok ?? 0, deps.config.agentPriceOutPerMTok ?? 0), createdAt: nowSeconds(),
  }
  deps.db.insert(agentUsage).values(row).onConflictDoUpdate({ target: agentUsage.invoiceId, set: row }).run()
}
