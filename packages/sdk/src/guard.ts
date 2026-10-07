import { decidePayment, inspectChallenge, type ChallengeLike, type GuardDecision, type RecipientCheck } from '@bound/core'
import type { VerifyResponse } from './index'

export type PreparedPaymentLike = {
  challenge: ChallengeLike
  createCredential: () => Promise<string>
  setCredential: (request: RequestInit, credential: string) => RequestInit
}
/** The two members of an `mppx` client the guard needs; create it with `polyfill: false` so the guard owns the 402 flow. */
export type MppxLike = {
  rawFetch(input: string, init?: RequestInit): Promise<Response>
  preparePayment(response: Response, opts?: { request?: RequestInit }): Promise<PreparedPaymentLike>
}
export type GuardOptions = {
  bound: { verifyService(i: { address: string; domain?: string }): Promise<VerifyResponse> }
  mppx: MppxLike
  /** The service the agent means to pay. Caller configuration, never read from the API's own response. Default: the URL's hostname. */
  serviceDomain?: string
  /** Addresses accepted without a Bound check (e.g. a platform-fee split you trust). Case-insensitive. */
  allowRecipients?: string[]
  onAsk?: 'block' | 'allow'
  expectedChainId?: number
  onDecision?: (d: GuardDecision & { url: string }) => void
}

export class PaymentBlockedError extends Error {
  constructor(readonly decision: GuardDecision & { url: string }) {
    super(`Payment blocked before signing: ${decision.reason}`)
    this.name = 'PaymentBlockedError'
  }
}

/** A fetch that, on an MPP 402, verifies every recipient with Bound before it signs anything. Denials throw PaymentBlockedError. */
export function createGuardedFetch(o: GuardOptions): (input: string | URL, init?: RequestInit) => Promise<Response> {
  const allow = new Set((o.allowRecipients ?? []).map((a) => a.toLowerCase()))
  return async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.toString()
    const first = await o.mppx.rawFetch(url, init)
    if (first.status !== 402) return first
    const payment = await o.mppx.preparePayment(first, { request: init })
    const inspected = inspectChallenge(payment.challenge, { expectedChainId: o.expectedChainId })
    let decision: GuardDecision
    if (!inspected.ok) decision = { allow: false, reason: inspected.reason, checks: [] }
    else if (inspected.free) decision = { allow: true, reason: 'no money moves (identity proof)', checks: [] }
    else {
      const domain = o.serviceDomain ?? new URL(url).hostname
      const checks: RecipientCheck[] = []
      for (const recipient of inspected.recipients) {
        if (allow.has(recipient.address.toLowerCase())) {
          checks.push({ recipient, verdict: null, action: null, payee: null, allowed: true })
          continue
        }
        // splits are checked without a domain: is each one an active Bound-verified wallet at all
        try {
          const r = await o.bound.verifyService({ address: recipient.address, domain: recipient.role === 'primary' ? domain : undefined })
          checks.push({ recipient, verdict: r.verdict, action: r.action, payee: r.payee ? { legalName: r.payee.legalName, domain: r.payee.domain } : null, allowed: false })
        } catch (e) {
          checks.push({ recipient, verdict: null, action: null, payee: null, allowed: false, error: (e as Error)?.message ?? String(e) })
        }
      }
      decision = decidePayment(checks, { onAsk: o.onAsk })
    }
    const full = { ...decision, url }
    o.onDecision?.(full)
    if (!decision.allow) throw new PaymentBlockedError(full)
    const credential = await payment.createCredential()
    return o.mppx.rawFetch(url, payment.setCredential(init, credential))
  }
}
