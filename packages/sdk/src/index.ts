import type { Action, VerifyResult } from '@bound/core'
export { buildAuthorizeKeyCall, buildSetAllowlistCall, readAllowlist, withRecipient, decideAction } from '@bound/core'
export type { VerifyResult, Verdict, Action } from '@bound/core'
export * from './guard'

export type VerifyResponse = VerifyResult & { action: Action; checkId: string }
export type PayeeRow = Record<string, unknown>

class HttpError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

export class BoundClient {
  private f: typeof fetch
  constructor(private opts: { baseUrl: string; token?: string; fetch?: typeof fetch }) { this.f = opts.fetch ?? fetch }
  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.f(`${this.opts.baseUrl.replace(/\/$/, '')}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(this.opts.token ? { authorization: `Bearer ${this.opts.token}` } : {}), ...(init?.headers ?? {}) },
    })
    const body: any = await res.json().catch(() => ({}))
    if (!res.ok) throw new HttpError(body?.error ?? `HTTP ${res.status}`, res.status)
    return body as T
  }
  verifyPayee(i: { address: string; payeeName: string; senderDomain?: string }) {
    return this.req<VerifyResponse>('/v1/verify', { method: 'POST', body: JSON.stringify(i) })
  }
  /** Is this wallet the verified one for `domain`? Without a domain: is it an active Bound-verified wallet at all? */
  verifyService(i: { address: string; domain?: string }) {
    return this.req<VerifyResponse>('/v1/verify-service', { method: 'POST', body: JSON.stringify(i) })
  }
  /** Returns null when the wallet is unknown (404); other failures throw. */
  async getPayee(wallet: string): Promise<PayeeRow | null> {
    try {
      return await this.req<PayeeRow>(`/v1/payees/${encodeURIComponent(wallet)}`)
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return null
      throw e
    }
  }
}
