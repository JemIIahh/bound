import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

export type Db = BetterSQLite3Database<typeof schema>

export function createDb(path: string): Db {
  const sqlite = new Database(path)
  sqlite.pragma('journal_mode = WAL')
  return drizzle(sqlite, { schema })
}

const DDL = `
CREATE TABLE IF NOT EXISTS payees (wallet TEXT PRIMARY KEY, legal_name TEXT NOT NULL, domain TEXT NOT NULL, lei TEXT NOT NULL DEFAULT '', master_id TEXT NOT NULL, level INTEGER NOT NULL, active_from INTEGER NOT NULL, superseded_at INTEGER NOT NULL DEFAULT 0, revoked_at INTEGER NOT NULL DEFAULT 0, successor TEXT, evidence_hash TEXT NOT NULL, updated_block INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS payee_verifications (id TEXT PRIMARY KEY, wallet TEXT NOT NULL, legal_name TEXT NOT NULL, domain TEXT NOT NULL, lei TEXT NOT NULL DEFAULT '', nonce TEXT NOT NULL, signature TEXT, sig_verified INTEGER NOT NULL DEFAULT 0, dns_verified INTEGER NOT NULL DEFAULT 0, lei_verified INTEGER NOT NULL DEFAULT 0, lei_record_json TEXT, salt TEXT, master_id TEXT, master_status TEXT NOT NULL DEFAULT 'none', attest_tx TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS orgs (id TEXT PRIMARY KEY, name TEXT NOT NULL, root_address TEXT NOT NULL, agent_key_address TEXT NOT NULL, agent_key_enc TEXT NOT NULL, token_hash TEXT NOT NULL, limit_base TEXT NOT NULL, period_seconds INTEGER NOT NULL, authorize_tx TEXT, authorized INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS pins (org_id TEXT NOT NULL, wallet TEXT NOT NULL, label TEXT NOT NULL, approved_at INTEGER NOT NULL, tx_hash TEXT, active INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (org_id, wallet));
CREATE TABLE IF NOT EXISTS invoices (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, raw TEXT NOT NULL, payee_name TEXT, address TEXT, amount_base TEXT, currency TEXT, invoice_no TEXT, sender_domain TEXT, due_date TEXT, verdict_json TEXT, action TEXT, status TEXT NOT NULL DEFAULT 'new', agent_log TEXT, lab INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS approvals (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, invoice_id TEXT NOT NULL, wallet TEXT NOT NULL, label TEXT NOT NULL, verdict_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', tx_hash TEXT, created_at INTEGER NOT NULL, prepared_at INTEGER);
CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, invoice_id TEXT NOT NULL, to_address TEXT NOT NULL, amount_base TEXT NOT NULL, memo TEXT NOT NULL, tx_hash TEXT, status TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS payments_invoice_unique ON payments (invoice_id);
CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, org_id TEXT, kind TEXT NOT NULL, invoice_id TEXT, detail_json TEXT NOT NULL DEFAULT '{}', tx_hash TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS indexer_state (id TEXT PRIMARY KEY, last_block INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS demo_runs (id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL, guard_off INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS demo_runs_created ON demo_runs (created_at);
`

export function migrate(db: Db) {
  const sqlite = (db as any).$client as Database.Database
  sqlite.exec(DDL)
  // columns added after a table was first created (CREATE TABLE IF NOT EXISTS does not add them)
  const approvalCols = sqlite.prepare('PRAGMA table_info(approvals)').all() as { name: string }[]
  if (!approvalCols.some((c) => c.name === 'prepared_at')) sqlite.exec('ALTER TABLE approvals ADD COLUMN prepared_at INTEGER')
}
