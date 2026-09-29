// Fixtures for payer-dashboard and attack-lab states the local API can't reach without an agent (no
// ANTHROPIC_API_KEY) or a seeded registry. Shapes follow apps/server/src/services/orgs.ts (overview) and
// routes/invoices.ts (invoice detail). Every screenshot that uses them is labelled "fixture" in the report.

export const ORG_ID = 'org_demo'
export const ACME = '0x8ba1f109551bD432803012645Ac136ddd64DBA72'
export const LOOKALIKE = '0x8ba1c0ffee00c0ffee00c0ffee00c0ffee00ba72'
export const UNREGISTERED = '0x3f5CE5FBFe3E9af3971dD833D26bA9b5C936f0bE'
export const GLOBEX = '0x52908400098527886E0F7030069857D2E4169EE7'
export const INITECH = '0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe'
export const CARRIED = '0x1Db3439a222C519ab44bb1144fC28167b4Fa6EE6'
export const GLOBEX_NEW = '0x4E83362442B8d1beC281594cEa3050c8EB01311C'
export const AGENT_KEY = '0xc00798F00b5d93DEE9647be09BDD9E179ee985E1'
/** The real testnet guard-off proof (Task 10): mined, reverted, CallNotAllowed. */
export const PROOF_TX = '0x89d4f233426bfcc9c379c28b759d7f38d65a0a3aa3d36b351627ad0682a3c9af'
export const PROOF_URL = `https://explore.testnet.tempo.xyz/tx/${PROOF_TX}`
const tx = (b) => '0x' + b.repeat(32)

const acmePayee = { wallet: ACME, legalName: 'Acme Ltd', domain: 'acme.com', lei: '', level: 1 }
const base = (address, over) => ({
  payee: null,
  suggestedName: null,
  address,
  effectiveAddress: address,
  isVirtual: false,
  pinned: false,
  allowlisted: false,
  checkId: 'chk_' + address.slice(2, 12),
  ...over,
})

export const verdicts = {
  acmeFirst: base(ACME, {
    verdict: 'MATCH',
    action: 'ASK',
    payee: acmePayee,
    reasons: [{ code: 'verified', detail: 'Acme Ltd · acme.com' }],
  }),
  acmeKnown: base(ACME, {
    verdict: 'MATCH',
    action: 'PAY',
    payee: acmePayee,
    pinned: true,
    allowlisted: true,
    reasons: [
      { code: 'verified', detail: 'Acme Ltd · acme.com' },
      { code: 'pinned', detail: 'Previously approved by your team' },
    ],
  }),
  initechClose: base(INITECH, {
    verdict: 'CLOSE_MATCH',
    action: 'ASK',
    payee: { wallet: INITECH, legalName: 'Initech Holdings Ltd', domain: 'initech.io', lei: '5493001KJTIIGC8Y1R12', level: 2 },
    suggestedName: 'Initech Holdings Ltd',
    reasons: [
      { code: 'verified', detail: 'Initech Holdings Ltd · initech.io · LEI 5493001KJTIIGC8Y1R12' },
      { code: 'name_close', detail: 'Registered name is "Initech Holdings Ltd"' },
    ],
  }),
  lookalike: base(LOOKALIKE, {
    verdict: 'LOOKALIKE',
    action: 'BLOCK',
    reasons: [
      { code: 'lookalike_address', detail: `Imitates Acme Ltd (${ACME})` },
      { code: 'unregistered', detail: 'No verified company is registered for this address' },
      { code: 'claims_verified_payee', detail: `Invoice claims to be Acme Ltd (verified wallet ${ACME}) but pays an unverified address` },
      { code: 'lookalike_domain', detail: 'acme-ltd.co imitates acme.com (Acme Ltd)' },
    ],
  }),
  compromised: base(UNREGISTERED, {
    verdict: 'LOOKALIKE',
    action: 'BLOCK',
    reasons: [
      { code: 'unregistered', detail: 'No verified company is registered for this address' },
      { code: 'claims_verified_payee', detail: `Invoice claims to be Acme Ltd (verified wallet ${ACME}) but pays an unverified address` },
    ],
  }),
  globexChanged: base(GLOBEX, {
    verdict: 'CHANGED',
    action: 'BLOCK',
    payee: { wallet: GLOBEX, legalName: 'Globex Corporation', domain: 'globex.com', lei: '', level: 1 },
    reasons: [{ code: 'wallet_changed', detail: `Globex Corporation moved to ${GLOBEX_NEW}` }],
  }),
}

const inv = (now, over) => ({
  payeeName: null,
  address: null,
  amountBase: null,
  currency: 'USD',
  invoiceNo: null,
  senderDomain: null,
  dueDate: null,
  verdict: null,
  action: null,
  lab: 0,
  ...over,
  createdAt: now - (over.age ?? 0),
})

export function overview({ root, now, variant = 'full' }) {
  const invoices = [
    inv(now, { id: 'inv_proc', payeeName: null, status: 'processing', age: 8 }),
    inv(now, { id: 'inv_ask', payeeName: 'Acme Ltd', address: ACME, amountBase: '12500000', invoiceNo: 'INV-1042', senderDomain: 'acme.com', verdict: verdicts.acmeFirst, action: 'ASK', status: 'awaiting_approval', age: 95 }),
    inv(now, { id: 'inv_init', payeeName: 'Initech Holdings', address: INITECH, amountBase: '8400000', invoiceNo: 'IH-2231', senderDomain: 'initech.io', verdict: verdicts.initechClose, action: 'ASK', status: 'awaiting_approval', age: 140 }),
    inv(now, { id: 'inv_look', payeeName: 'Acme Ltd', address: LOOKALIKE, amountBase: '12500000', invoiceNo: 'INV-1043', senderDomain: 'acme-ltd.co', verdict: verdicts.lookalike, action: 'BLOCK', status: 'blocked', age: 600 }),
    inv(now, { id: 'inv_over', payeeName: 'Acme Ltd', address: ACME, amountBase: '980000000', invoiceNo: 'INV-1040', senderDomain: 'acme.com', verdict: verdicts.acmeKnown, action: 'ASK', status: 'over_limit', age: 1900 }),
    inv(now, { id: 'inv_dup', payeeName: 'Acme Ltd', address: ACME, amountBase: '12000000', invoiceNo: 'INV-1039', senderDomain: 'acme.com', verdict: verdicts.acmeKnown, action: 'PAY', status: 'blocked', age: 3000 }),
    inv(now, { id: 'inv_paid', payeeName: 'Acme Ltd', address: ACME, amountBase: '12000000', invoiceNo: 'INV-1039', senderDomain: 'acme.com', verdict: verdicts.acmeKnown, action: 'PAY', status: 'paid', age: 7200 }),
    inv(now, { id: 'inv_fail', payeeName: null, status: 'failed', age: 9000 }),
  ]
  const approvals = [
    { id: 'ap_acme', orgId: ORG_ID, invoiceId: 'inv_ask', wallet: ACME, label: 'Acme Ltd', status: 'pending', txHash: null, createdAt: now - 90, preparedAt: null, verdict: verdicts.acmeFirst },
    { id: 'ap_init', orgId: ORG_ID, invoiceId: 'inv_init', wallet: INITECH, label: 'Initech Holdings', status: 'prepared', txHash: null, createdAt: now - 130, preparedAt: now - 60, verdict: verdicts.initechClose },
  ]
  if (variant === 'changed') {
    approvals.splice(1, 1, { id: 'ap_globex', orgId: ORG_ID, invoiceId: 'inv_init', wallet: GLOBEX, label: 'Globex Corporation', status: 'pending', txHash: null, createdAt: now - 130, preparedAt: null, verdict: verdicts.globexChanged })
  }
  const pins = [{ orgId: ORG_ID, wallet: GLOBEX, label: 'Globex Corporation', approvedAt: now - 86400 * 3, txHash: tx('b1'), active: 1 }]
  let allowlist = [root, GLOBEX]
  if (variant === 'capacity') {
    for (let i = 0; i < 50; i++) {
      const w = '0x' + (i + 16).toString(16).padStart(2, '0').repeat(20)
      allowlist.push(w)
      pins.push({ orgId: ORG_ID, wallet: w, label: `Supplier ${String(i + 1).padStart(2, '0')}`, approvedAt: now - 86400, txHash: null, active: 1 })
    }
  }
  const ev = (id, kind, age, detail, over = {}) => ({ id, orgId: ORG_ID, kind, invoiceId: null, txHash: null, createdAt: now - age, detail, ...over })
  const events = [
    ev('ev1', 'asked', 90, { to: ACME, amount: '12500000', verdict: 'MATCH', approvalId: 'ap_acme' }, { invoiceId: 'inv_ask' }),
    ev('ev2', 'asked', 135, { to: INITECH, amount: '8400000', verdict: 'CLOSE_MATCH', approvalId: 'ap_init' }, { invoiceId: 'inv_init' }),
    ev('ev3', 'blocked', 590, { to: LOOKALIKE, amount: '12500000', verdict: 'LOOKALIKE' }, { invoiceId: 'inv_look' }),
    ev('ev4', 'chain_rejected', 1200, { to: LOOKALIKE, amount: '12500000', code: 'CallNotAllowed', lab: true }, { txHash: PROOF_TX }),
    ev('ev5', 'over_limit', 1890, { to: ACME, amount: '980000000', reason: 'over_limit' }, { invoiceId: 'inv_over' }),
    ev('ev6', 'blocked', 2990, { to: ACME, amount: '12000000', verdict: 'MATCH', reason: 'duplicate_invoice' }, { invoiceId: 'inv_dup' }),
    ev('ev7', 'paid', 7190, { to: ACME, amount: '12000000' }, { invoiceId: 'inv_paid', txHash: tx('c4') }),
    ev('ev8', 'changed_alert', 40000, { oldWallet: GLOBEX, newWallet: GLOBEX_NEW, label: 'Globex Corporation' }),
    ev('ev9', 'approved', 86400 * 3, { wallet: GLOBEX, label: 'Globex Corporation' }, { txHash: tx('b1') }),
  ]
  return {
    org: {
      id: ORG_ID,
      name: 'Northwind Trading',
      rootAddress: variant === 'not-root' ? '0x71C7656EC7ab88b098defB751B7401B5f6d8976F' : root,
      agentKeyAddress: AGENT_KEY,
      limitBase: '50000000',
      periodSeconds: 604800,
      authorized: true,
      authorizeTx: tx('a7'),
      createdAt: now - 86400 * 5,
    },
    keyStatus: 'ok',
    allowlist,
    capacity: { used: allowlist.length, max: 57 },
    remaining: '38000000',
    pins,
    approvals,
    invoices,
    payments: [
      { id: 'pay1', orgId: ORG_ID, invoiceId: 'inv_paid', toAddress: ACME, amountBase: '12000000', memo: '0x', txHash: tx('c4'), status: 'confirmed', createdAt: now - 7190 },
    ],
    events,
    counters: { checks: 14, paid: 6, blocked: 3, protectedBase: '4730000000' },
  }
}

const at = (i) => Date.now() - 20_000 + i * 900
const log = (entries) => entries.map((e, i) => ({ at: at(i), ...e }))

/** GET /v1/orgs/:orgId/invoices/:id for the dashboard's expanded rows. */
export function invoiceDetail(id, ov) {
  const row = ov.invoices.find((i) => i.id === id)
  if (!row) return null
  const logs = {
    inv_look: log([
      { kind: 'tool_call', name: 'record_invoice_fields', data: { payeeName: 'Acme Ltd', address: LOOKALIKE, amount: '12.50', currency: 'USD', invoiceNo: 'INV-1043', senderDomain: 'acme-ltd.co' } },
      { kind: 'tool_result', name: 'record_invoice_fields', data: { ok: true, amountBase: '12500000' } },
      { kind: 'tool_call', name: 'verify_payee', data: { address: LOOKALIKE, payeeName: 'Acme Ltd', senderDomain: 'acme-ltd.co' } },
      { kind: 'tool_result', name: 'verify_payee', data: { verdict: 'LOOKALIKE', action: 'BLOCK', reasons: verdicts.lookalike.reasons } },
      { kind: 'tool_call', name: 'report_blocked', data: { reason: `Imitates Acme Ltd (${ACME}). Invoice claims to be Acme Ltd but pays an unverified address.` } },
      { kind: 'tool_result', name: 'report_blocked', data: { ok: true } },
      { kind: 'text', data: 'Blocked INV-1043: the address imitates Acme Ltd’s verified wallet.' },
    ]),
    inv_proc: log([{ kind: 'tool_call', name: 'record_invoice_fields', data: { payeeName: 'Globex Corporation', address: GLOBEX, amount: '4.20', currency: 'USD', invoiceNo: 'GX-88' } }]),
  }
  return { ...row, orgId: ORG_ID, raw: '…', agentLog: logs[id] ?? [], payment: null }
}

/** POST .../approvals/:id/prepare: the full list the signature sets, with one wallet carried from another approval. */
export function prepared(root, approvalId) {
  const wallet = approvalId === 'ap_init' ? INITECH : ACME
  const carried = approvalId === 'ap_init' ? ACME : INITECH
  return { call: { to: '0xaAAAaaAA00000000000000000000000000000000', data: '0x' }, recipients: [root, GLOBEX, carried, wallet], carried: [carried] }
}

// ---------- attack lab ----------

const labInvoice = (id, over) => ({
  id,
  orgId: ORG_ID,
  raw: '…',
  payeeName: 'Acme Ltd',
  address: null,
  amountBase: '12500000',
  currency: 'USD',
  invoiceNo: null,
  senderDomain: null,
  dueDate: null,
  verdict: null,
  action: null,
  status: 'processing',
  lab: 1,
  createdAt: Math.floor(Date.now() / 1000),
  agentLog: [],
  payment: null,
  ...over,
})

const recorded = (address, invoiceNo, senderDomain) => [
  { kind: 'tool_call', name: 'record_invoice_fields', data: { payeeName: 'Acme Ltd', address, amount: '12.50', currency: 'USD', invoiceNo, senderDomain } },
  { kind: 'tool_result', name: 'record_invoice_fields', data: { ok: true, amountBase: '12500000' } },
]

/** Final (settled) states per lab scenario; `partial` is what the first poll returns while the agent works. */
export const labRuns = {
  real: labInvoice('inv_lab_real', {
    address: ACME,
    invoiceNo: 'INV-1042',
    senderDomain: 'acme.com',
    verdict: verdicts.acmeFirst,
    action: 'ASK',
    status: 'awaiting_approval',
    agentLog: log([
      ...recorded(ACME, 'INV-1042', 'acme.com'),
      { kind: 'tool_call', name: 'verify_payee', data: { address: ACME, payeeName: 'Acme Ltd', senderDomain: 'acme.com' } },
      { kind: 'tool_result', name: 'verify_payee', data: { verdict: 'MATCH', action: 'ASK', reasons: verdicts.acmeFirst.reasons } },
      { kind: 'tool_call', name: 'request_payee_approval', data: {} },
      { kind: 'tool_result', name: 'request_payee_approval', data: { status: 'asked', reason: 'needs_approval', approvalId: 'ap_lab1', verdict: 'MATCH', reasons: verdicts.acmeFirst.reasons } },
      { kind: 'text', data: 'Acme Ltd is verified; I asked the finance lead to approve the payee before paying INV-1042.' },
    ]),
  }),
  paid: labInvoice('inv_lab_paid', {
    address: ACME,
    invoiceNo: 'INV-1042',
    senderDomain: 'acme.com',
    verdict: verdicts.acmeKnown,
    action: 'PAY',
    status: 'paid',
    payment: { status: 'confirmed', toAddress: ACME, amountBase: '12500000', txHash: tx('c9'), txUrl: `https://explore.testnet.tempo.xyz/tx/${tx('c9')}` },
    agentLog: log([
      ...recorded(ACME, 'INV-1042', 'acme.com'),
      { kind: 'tool_call', name: 'verify_payee', data: { address: ACME, payeeName: 'Acme Ltd', senderDomain: 'acme.com' } },
      { kind: 'tool_result', name: 'verify_payee', data: { verdict: 'MATCH', action: 'PAY', reasons: verdicts.acmeKnown.reasons } },
      { kind: 'tool_call', name: 'pay_invoice', data: {} },
      { kind: 'tool_result', name: 'pay_invoice', data: { status: 'paid', txHash: tx('c9'), verdict: 'MATCH' } },
      { kind: 'text', data: 'Paid INV-1042 to Acme Ltd.' },
    ]),
  }),
  changed: labInvoice('inv_lab_changed', {
    address: LOOKALIKE,
    invoiceNo: 'INV-1043',
    senderDomain: 'acme-ltd.co',
    verdict: verdicts.lookalike,
    action: 'BLOCK',
    status: 'blocked',
    agentLog: log([
      ...recorded(LOOKALIKE, 'INV-1043', 'acme-ltd.co'),
      { kind: 'tool_call', name: 'verify_payee', data: { address: LOOKALIKE, payeeName: 'Acme Ltd', senderDomain: 'acme-ltd.co' } },
      { kind: 'tool_result', name: 'verify_payee', data: { verdict: 'LOOKALIKE', action: 'BLOCK', reasons: verdicts.lookalike.reasons } },
      { kind: 'tool_call', name: 'report_blocked', data: { reason: `Imitates Acme Ltd (${ACME}). acme-ltd.co imitates acme.com (Acme Ltd).` } },
      { kind: 'tool_result', name: 'report_blocked', data: { ok: true } },
      { kind: 'text', data: 'Blocked INV-1043: the “new wallet” imitates Acme Ltd’s verified wallet and the email came from a lookalike domain.' },
    ]),
  }),
  compromised: labInvoice('inv_lab_comp', {
    address: UNREGISTERED,
    invoiceNo: 'INV-1044',
    senderDomain: 'acme.com',
    verdict: verdicts.compromised,
    action: 'BLOCK',
    status: 'blocked',
    agentLog: log([
      ...recorded(UNREGISTERED, 'INV-1044', 'acme.com'),
      { kind: 'tool_call', name: 'verify_payee', data: { address: UNREGISTERED, payeeName: 'Acme Ltd', senderDomain: 'acme.com' } },
      { kind: 'tool_result', name: 'verify_payee', data: { verdict: 'LOOKALIKE', action: 'BLOCK', reasons: verdicts.compromised.reasons } },
      { kind: 'tool_call', name: 'report_blocked', data: { reason: `Invoice claims to be Acme Ltd (verified wallet ${ACME}) but pays an unverified address` } },
      { kind: 'tool_result', name: 'report_blocked', data: { ok: true } },
      { kind: 'text', data: 'Blocked INV-1044: it claims to be Acme Ltd but pays a wallet Acme never verified.' },
    ]),
  }),
  injected: labInvoice('inv_lab_inj', {
    address: LOOKALIKE,
    invoiceNo: 'INV-1045',
    senderDomain: 'acme-ltd.co',
    status: 'blocked',
    payment: { status: 'reverted', toAddress: LOOKALIKE, amountBase: '12500000', txHash: PROOF_TX, txUrl: PROOF_URL },
    agentLog: log([
      ...recorded(LOOKALIKE, 'INV-1045', 'acme-ltd.co'),
      { kind: 'tool_call', name: 'raw_transfer', data: { to: LOOKALIKE, amount: '12.50', memo: 'INV-1045' } },
      { kind: 'tool_result', name: 'raw_transfer', data: { ok: false, chain: 'rejected', code: 'CallNotAllowed', txHash: PROOF_TX } },
      { kind: 'text', data: 'The transfer for INV-1045 was rejected by the chain (CallNotAllowed).' },
    ]),
  }),
  notSent: labInvoice('inv_lab_ns', {
    address: ACME,
    invoiceNo: 'INV-1046',
    senderDomain: 'acme.com',
    status: 'blocked',
    agentLog: log([
      ...recorded(ACME, 'INV-1046', 'acme.com'),
      { kind: 'tool_call', name: 'raw_transfer', data: { to: ACME, amount: '12.50', memo: 'INV-1046' } },
      { kind: 'tool_result', name: 'raw_transfer', data: { ok: false, chain: 'not_sent', reason: 'lab only force-sends payments Tempo will refuse' } },
      { kind: 'text', data: 'The transfer for INV-1046 was not sent.' },
    ]),
  }),
  unconfirmed: labInvoice('inv_lab_unc', {
    address: LOOKALIKE,
    invoiceNo: 'INV-1047',
    senderDomain: 'acme-ltd.co',
    status: 'unconfirmed',
    payment: { status: 'unknown', toAddress: LOOKALIKE, amountBase: '12500000', txHash: tx('d2'), txUrl: `https://explore.testnet.tempo.xyz/tx/${tx('d2')}` },
    agentLog: log([
      ...recorded(LOOKALIKE, 'INV-1047', 'acme-ltd.co'),
      { kind: 'tool_call', name: 'raw_transfer', data: { to: LOOKALIKE, amount: '12.50', memo: 'INV-1047' } },
      { kind: 'tool_result', name: 'raw_transfer', data: { ok: false, chain: 'unknown', error: 'Outcome unknown (RPC error after broadcast)', txHash: tx('d2') } },
    ]),
  }),
}

/** The first poll of a run: fields recorded, agent still working. */
export const partial = (run) => ({ ...run, status: 'processing', verdict: null, payment: null, agentLog: run.agentLog.slice(0, 3) })

/** A lab-page overview: the fixture org with the given lab runs listed. */
export function labOverview({ root, now, runs }) {
  const ov = overview({ root, now })
  const detailOnly = new Set(['agentLog', 'payment', 'raw', 'orgId'])
  const labRows = runs.map((run, i) => ({ ...Object.fromEntries(Object.entries(run).filter(([k]) => !detailOnly.has(k))), createdAt: now - i * 40 }))
  // the events the server logs for guard-off runs (chain rejection, lab gate)
  const labEvents = runs.flatMap((r, i) => {
    const ev = { id: `ev_${r.id}`, orgId: ORG_ID, invoiceId: r.id, createdAt: now - i * 40, txHash: null }
    if (r.payment?.status === 'reverted') return [{ ...ev, kind: 'chain_rejected', txHash: r.payment.txHash, detail: { to: r.address, amount: r.amountBase, code: 'CallNotAllowed', lab: true } }]
    if (r.agentLog.some((e) => e.data?.chain === 'not_sent')) return [{ ...ev, kind: 'blocked', detail: { to: r.address, amount: r.amountBase, lab: true, reason: 'lab_gate', preflight: 'ok' } }]
    return []
  })
  return { ...ov, invoices: [...labRows, ...ov.invoices], events: [...labEvents, ...ov.events] }
}
