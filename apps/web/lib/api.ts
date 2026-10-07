/**
 * Thin client for the Bound REST API. Every decision (verdicts, levels, what is allowed) comes from the
 * server; this file only moves JSON and describes its shape.
 */

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787').replace(/\/+$/, '')

export type Hex = `0x${string}`

export type Verdict = 'MATCH' | 'CLOSE_MATCH' | 'NO_MATCH' | 'LOOKALIKE' | 'CHANGED' | 'REVOKED'
export type Action = 'PAY' | 'ASK' | 'BLOCK'
export type Reason = { code: string; detail: string }

/** `POST /v1/verify` */
export type VerifyResult = {
  verdict: Verdict
  payee: { wallet: Hex; legalName: string; domain: string; lei: string; level: 1 | 2 } | null
  suggestedName: string | null
  reasons: Reason[]
  address: Hex
  effectiveAddress: Hex
  isVirtual: boolean
  pinned: boolean
  allowlisted: boolean
  action?: Action
  checkId?: string
}

export type DnsRecord = { name: string; type: 'TXT'; value: string }
export type MasterStatus = 'none' | 'mining' | 'mined' | 'registered' | 'failed'

/** EIP-712 claim the payee wallet signs (built by the server). */
export type PayeeClaimTypedData = {
  domain: { name: string; version: string }
  types: { PayeeClaim: { name: string; type: string }[] }
  primaryType: 'PayeeClaim'
  message: { legalName: string; domain: string; wallet: Hex; nonce: string }
}

/** `GET /v1/payee-verifications/:id` */
export type PayeeVerification = {
  id: string
  wallet: Hex
  legalName: string
  domain: string
  lei: string
  sigVerified: boolean
  dnsVerified: boolean
  leiVerified: boolean
  salt: Hex | null
  masterId: Hex | null
  masterStatus: MasterStatus
  attestTx: Hex | null
  status: 'pending' | 'attested' | 'failed'
  createdAt: number
  dns: DnsRecord
  typedData: PayeeClaimTypedData
}

/** `GET /v1/payees/:wallet` (the registry mirror) */
export type Payee = {
  wallet: Hex
  legalName: string
  domain: string
  lei: string
  masterId: Hex
  level: number
  activeFrom: number
  supersededAt: number
  revokedAt: number
  successor: Hex | null
  evidenceHash: Hex
  updatedBlock: number
}

// ---------- payer (org) API ----------

/** A call the org's root wallet signs and sends (built by the server). */
export type RootCall = { to: Hex; data: Hex }

/** Stored verdict: the verify result plus the action for this org. */
export type StoredVerdict = VerifyResult & { action: Action; checkId: string }

/** `POST /v1/orgs` */
export type CreatedOrg = { org: { id: string; name: string; rootAddress: Hex; agentKeyAddress: Hex }; token: string; authorizeCall: RootCall }

export type InvoiceStatus = 'new' | 'processing' | 'awaiting_approval' | 'over_limit' | 'paid' | 'blocked' | 'failed' | 'unconfirmed'

export type OrgInvoice = {
  id: string
  payeeName: string | null
  address: Hex | null
  amountBase: string | null
  currency: string | null
  invoiceNo: string | null
  senderDomain: string | null
  dueDate: string | null
  verdict: StoredVerdict | null
  action: Action | null
  status: InvoiceStatus
  lab: number
  createdAt: number
}

export type ApprovalStatus = 'pending' | 'prepared' | 'approved' | 'rejected'
export type Approval = {
  id: string
  orgId: string
  invoiceId: string
  wallet: Hex
  label: string
  status: ApprovalStatus
  txHash: Hex | null
  createdAt: number
  preparedAt: number | null
  verdict: StoredVerdict | null
}

export type Pin = { orgId: string; wallet: Hex; label: string; approvedAt: number; txHash: Hex | null; active: number }

export type OrgEvent = {
  id: string
  orgId: string | null
  kind: string
  invoiceId: string | null
  txHash: Hex | null
  createdAt: number
  detail: Record<string, unknown> | null
}

export type Payment = { id: string; invoiceId: string; toAddress: Hex; amountBase: string; txHash: Hex | null; status: string; createdAt: number }

/** `GET /v1/orgs/:orgId/overview` */
export type Overview = {
  org: {
    id: string
    name: string
    rootAddress: Hex
    agentKeyAddress: Hex
    limitBase: string
    periodSeconds: number
    authorized: boolean
    authorizeTx: Hex | null
    createdAt: number
  }
  keyStatus: 'unauthorized' | 'ok' | 'unrestricted' | 'unavailable'
  allowlist: Hex[]
  capacity: { used: number; max: number }
  remaining: string | null
  pins: Pin[]
  approvals: Approval[]
  invoices: OrgInvoice[]
  payments: Payment[]
  events: OrgEvent[]
  counters: { checks: number; paid: number; blocked: number; protectedBase: string }
}

export type AgentLogEntry = { at: number; kind: 'tool_call' | 'tool_result' | 'text'; name?: string; data: unknown }

/** `GET /v1/orgs/:orgId/invoices/:invoiceId` */
export type InvoiceDetail = OrgInvoice & {
  orgId: string
  raw: string
  agentLog: AgentLogEntry[]
  payment: { status: string; toAddress: Hex; amountBase: string; txHash: Hex | null; txUrl: string | null } | null
}

/** One attack-lab run as the result card reads it: an org invoice, or a public demo run (`GET /v1/demo/runs/:runId`). */
export type RunDetail = Omit<InvoiceDetail, 'orgId' | 'raw'> & {
  /** Public demo only: the model call failed (missing or rejected key, outage). */
  offline?: boolean
}

/** `GET /v1/demo`: whether the public demo can start a run now. `message` is shown as is. */
export type DemoStatus = { status: 'ready' | 'unavailable' | 'offline' | 'busy'; message: string | null; runsPerHour: number; maxChars: number }

/** `GET /v1/demo/api-runs/status`: whether the paid-API demo can start a run now. `message` is shown as is. */
export type ApiRunStatus = { status: 'ready' | 'unavailable' | 'busy'; message: string | null; runsPerHour: number }

/** One step of a paid-API demo run: one plain sentence, plus whatever the server adds (addresses, amounts). */
export type ApiRunStep = { kind: 'request' | 'challenge' | 'check' | 'decision' | 'sign' | 'result'; text: string; data?: unknown }

/** `POST /v1/demo/api-runs` `{ hijacked, guardOff }`: an agent step buys data from the demo paid API (MPP, HTTP 402). */
export type ApiRunResult = {
  steps: ApiRunStep[]
  outcome: 'paid' | 'blocked_by_bound' | 'blocked_by_tempo' | 'failed'
  /** The wallet the API asked to be paid. */
  recipient: string
  txHash: string | null
  txUrl: string | null
  /** One plain sentence. */
  message: string
}

/** `POST /v1/orgs/:orgId/approvals/:id/prepare` */
export type PreparedApproval = {
  call: RootCall
  /** The whole allowlist the signature sets. */
  recipients: Hex[]
  /** Wallets in `recipients` only because another approval is pending. */
  carried: Hex[]
}

export type PayResult = { status: 'paid' | 'asked' | 'blocked' | 'failed'; txHash?: Hex; reason?: string; approvalId?: string }

export type ApiIssue = { path: (string | number)[]; message: string }

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues: ApiIssue[] = [],
    /** Machine-readable reason some routes add (the public demo: unavailable, offline, busy). */
    readonly code?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }

  /** Validation messages keyed by the first path segment (the request field). */
  get fields(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const i of this.issues) {
      const key = String(i.path[0] ?? '')
      if (key && !out[key]) out[key] = i.message
    }
    return out
  }
}

export const orgTokenKey = (orgId: string) => `bound.orgToken.${orgId}`

export function readOrgToken(orgId: string): string | null {
  try {
    return localStorage.getItem(orgTokenKey(orgId))
  } catch {
    return null
  }
}

export function saveOrgToken(orgId: string, token: string) {
  try {
    localStorage.setItem(orgTokenKey(orgId), token)
  } catch {
    // storage blocked: the token only lives for this page view
  }
}

/** Org ids this browser holds a token for. */
export function savedOrgIds(): string[] {
  const prefix = orgTokenKey('')
  try {
    return Object.keys(localStorage)
      .filter((k) => k.startsWith(prefix) && k.length > prefix.length)
      .map((k) => k.slice(prefix.length))
  } catch {
    return []
  }
}

export type ApiInit = Omit<RequestInit, 'body'> & {
  /** Sends `authorization: Bearer <token>` from `localStorage['bound.orgToken.<orgId>']`. */
  orgId?: string
  /** JSON request body. */
  json?: unknown
  body?: BodyInit
}

export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const { orgId, json, headers, ...rest } = init
  const h = new Headers(headers)
  if (json !== undefined) h.set('content-type', 'application/json')
  if (orgId) {
    const token = readOrgToken(orgId)
    if (token) h.set('authorization', `Bearer ${token}`)
  }

  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, { ...rest, headers: h, body: json !== undefined ? JSON.stringify(json) : rest.body })
  } catch {
    throw new ApiError(`Can't reach the Bound API at ${API_URL}.`, 0)
  }

  const body = (await res.json().catch(() => null)) as { error?: string; issues?: ApiIssue[]; code?: string } | null
  if (!res.ok) {
    const issues = Array.isArray(body?.issues) ? body.issues : []
    const code = typeof body?.code === 'string' ? body.code : undefined
    // an error with a code carries a message written for people, even on a 503
    const message =
      code && body?.error
        ? body.error
        : res.status >= 500
          ? `The Bound API had a problem (${res.status}). Try again in a moment.`
          : (issues[0]?.message ?? body?.error ?? `Request failed (${res.status})`)
    throw new ApiError(message, res.status, issues, code)
  }
  return body as T
}

/** Human message for any thrown value (API errors, wallet errors from viem/wagmi). */
export function errorMessage(e: unknown): string {
  if (e && typeof e === 'object') {
    const err = e as { shortMessage?: string; message?: string; name?: string }
    if (err.name === 'UserRejectedRequestError' || /user (rejected|denied)/i.test(err.message ?? '')) return 'Request rejected in your wallet.'
    if (err.shortMessage) return err.shortMessage
    if (err.message) return err.message
  }
  return String(e)
}
