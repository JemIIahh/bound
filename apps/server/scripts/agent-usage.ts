// Prints the AI agent's usage and estimated cost (last 24 hours and all time), the busiest orgs, and the daily caps.
//   pnpm --filter @bound/server agent:usage        (reads DATABASE_PATH and the AGENT_* settings from the shell or apps/server/.env)
import { resolve } from 'node:path'
import Database from 'better-sqlite3'
import { config as loadDotenv } from 'dotenv'

loadDotenv({ path: resolve(import.meta.dirname, '../.env') }) // shell variables win
const path = process.env.DATABASE_PATH || './bound.db'
const num = (v: string | undefined, def: number) => (v && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : def)

let sqlite: Database.Database
try {
  sqlite = new Database(path, { readonly: true, fileMustExist: true })
} catch {
  console.error(`No database at ${path} (set DATABASE_PATH).`)
  process.exit(1)
}
const hasTable = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'agent_usage'").get()
type Totals = { runs: number; calls: number; input: number; output: number; cost: number }
const totals = (since: number): Totals =>
  hasTable
    ? (sqlite.prepare(`SELECT count(*) runs, coalesce(sum(calls),0) calls, coalesce(sum(input_tokens + cache_read_tokens + cache_write_tokens),0) input,
         coalesce(sum(output_tokens),0) output, coalesce(sum(cost_micro_usd),0) cost FROM agent_usage WHERE created_at > ?`).get(since) as Totals)
    : { runs: 0, calls: 0, input: 0, output: 0, cost: 0 }
const now = Math.floor(Date.now() / 1000)
const day = totals(now - 86_400)
const all = totals(0)
const runsToday = (sqlite.prepare('SELECT count(*) n FROM invoices WHERE created_at > ?').get(now - 86_400) as { n: number }).n
const top = hasTable
  ? (sqlite.prepare('SELECT org_id org, count(*) runs, sum(cost_micro_usd) cost FROM agent_usage GROUP BY org_id ORDER BY cost DESC LIMIT 5').all() as { org: string; runs: number; cost: number }[])
  : []
sqlite.close()

const usd = (micro: number) => `$${(micro / 1e6).toFixed(micro && micro < 10_000 ? 4 : 2)}`
const tok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n))
const line = (label: string, t: Totals) =>
  `${label.padEnd(10)}${String(t.runs).padStart(5)} runs · ${t.calls} model calls · ${tok(t.input)} in / ${tok(t.output)} out · ${usd(t.cost)}` +
  (t.runs ? ` · ${usd(Math.round(t.cost / t.runs))} per run` : '')

console.log(`Agent usage · model ${process.env.AGENT_MODEL || 'claude-opus-5-5'} · estimated at $${num(process.env.AGENT_PRICE_IN_PER_MTOK, 5)} in / $${num(process.env.AGENT_PRICE_OUT_PER_MTOK, 25)} out per million tokens`)
console.log(line('last 24h', day))
console.log(line('all time', all))
console.log(`daily caps: ${runsToday} of ${num(process.env.AGENT_RUNS_PER_DAY, 500)} runs used in the last 24h overall · ${num(process.env.AGENT_RUNS_PER_ORG_DAY, 50)} per org · public demo ${num(process.env.DEMO_RUNS_PER_DAY, 300)}`)
if (top.length) {
  console.log('top orgs by cost:')
  for (const o of top) console.log(`  ${o.org.padEnd(22)}${String(o.runs).padStart(5)} runs  ${usd(o.cost)}`)
}
