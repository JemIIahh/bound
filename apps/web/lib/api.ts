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

export type ApiIssue = { path: (string | number)[]; message: string }

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues: ApiIssue[] = [],
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

  const body = (await res.json().catch(() => null)) as { error?: string; issues?: ApiIssue[] } | null
  if (!res.ok) {
    const issues = Array.isArray(body?.issues) ? body.issues : []
    const message =
      res.status >= 500 ? `The Bound API had a problem (${res.status}). Try again in a moment.` : (issues[0]?.message ?? body?.error ?? `Request failed (${res.status})`)
    throw new ApiError(message, res.status, issues)
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
