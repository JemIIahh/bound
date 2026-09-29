import { integer, sqliteTable, text, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core'

export const payees = sqliteTable('payees', {
  wallet: text('wallet').primaryKey(),           // checksummed
  legalName: text('legal_name').notNull(),
  domain: text('domain').notNull(),
  lei: text('lei').notNull().default(''),
  masterId: text('master_id').notNull(),
  level: integer('level').notNull(),
  activeFrom: integer('active_from').notNull(),
  supersededAt: integer('superseded_at').notNull().default(0),
  revokedAt: integer('revoked_at').notNull().default(0),
  successor: text('successor'),
  evidenceHash: text('evidence_hash').notNull(),
  updatedBlock: integer('updated_block').notNull(),
})

export const payeeVerifications = sqliteTable('payee_verifications', {
  id: text('id').primaryKey(),
  wallet: text('wallet').notNull(),
  legalName: text('legal_name').notNull(),
  domain: text('domain').notNull(),
  lei: text('lei').notNull().default(''),
  nonce: text('nonce').notNull(),
  signature: text('signature'),
  sigVerified: integer('sig_verified').notNull().default(0),
  dnsVerified: integer('dns_verified').notNull().default(0),
  leiVerified: integer('lei_verified').notNull().default(0),
  leiRecordJson: text('lei_record_json'),
  salt: text('salt'),
  masterId: text('master_id'),
  masterStatus: text('master_status').notNull().default('none'), // none | mining | mined | registered | failed
  attestTx: text('attest_tx'),
  status: text('status').notNull().default('pending'),            // pending | attested | failed
  createdAt: integer('created_at').notNull(),
})

export const orgs = sqliteTable('orgs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  rootAddress: text('root_address').notNull(),
  agentKeyAddress: text('agent_key_address').notNull(),
  agentKeyEnc: text('agent_key_enc').notNull(),
  tokenHash: text('token_hash').notNull(),        // sha256 of the org API token
  limitBase: text('limit_base').notNull(),        // bigint as string, 6 decimals
  periodSeconds: integer('period_seconds').notNull(),
  authorizeTx: text('authorize_tx'),
  authorized: integer('authorized').notNull().default(0),
  createdAt: integer('created_at').notNull(),
})

export const pins = sqliteTable('pins', {
  orgId: text('org_id').notNull(),
  wallet: text('wallet').notNull(),
  label: text('label').notNull(),
  approvedAt: integer('approved_at').notNull(),
  txHash: text('tx_hash'),
  active: integer('active').notNull().default(1),
}, (t) => ({ pk: primaryKey({ columns: [t.orgId, t.wallet] }) }))

export const invoices = sqliteTable('invoices', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  raw: text('raw').notNull(),
  payeeName: text('payee_name'),
  address: text('address'),
  amountBase: text('amount_base'),
  currency: text('currency'),
  invoiceNo: text('invoice_no'),
  senderDomain: text('sender_domain'),
  dueDate: text('due_date'),
  verdictJson: text('verdict_json'),
  action: text('action'),                          // PAY | ASK | BLOCK
  status: text('status').notNull().default('new'),  // new | processing | awaiting_approval | paid | blocked | failed
  agentLog: text('agent_log'),
  lab: integer('lab').notNull().default(0),
  createdAt: integer('created_at').notNull(),
})

export const approvals = sqliteTable('approvals', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  invoiceId: text('invoice_id').notNull(),
  wallet: text('wallet').notNull(),
  label: text('label').notNull(),
  verdictJson: text('verdict_json').notNull(),
  status: text('status').notNull().default('pending'), // pending | prepared | approved | rejected
  txHash: text('tx_hash'),
  createdAt: integer('created_at').notNull(),
})

export const payments = sqliteTable('payments', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  invoiceId: text('invoice_id').notNull(),
  toAddress: text('to_address').notNull(),
  amountBase: text('amount_base').notNull(),
  memo: text('memo').notNull(),
  txHash: text('tx_hash'),
  status: text('status').notNull(),                 // submitting | confirmed | reverted | unknown
  createdAt: integer('created_at').notNull(),
}, (t) => ({ oneInvoice: uniqueIndex('payments_invoice_unique').on(t.invoiceId) }))

export const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  orgId: text('org_id'),
  kind: text('kind').notNull(),   // paid | blocked | approved | rejected | changed_alert | chain_rejected | asked
  invoiceId: text('invoice_id'),
  detailJson: text('detail_json').notNull().default('{}'),
  txHash: text('tx_hash'),
  createdAt: integer('created_at').notNull(),
})

export const indexerState = sqliteTable('indexer_state', {
  id: text('id').primaryKey(),
  lastBlock: integer('last_block').notNull(),
})
