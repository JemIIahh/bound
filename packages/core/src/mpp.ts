import { getAddress, isAddress, type Address } from 'viem'
import type { Action } from './policy'
import type { Verdict } from './verdict'

export type PaymentRecipient = { address: Address; role: 'primary' | 'split'; amount: string }
export type ChallengeLike = { method: string; intent: string; request: Record<string, unknown> }
export type Inspection =
  | { ok: true; free: boolean; chainId: number | null; recipients: PaymentRecipient[] }
  | { ok: false; reason: string }

const SUPPORTED_INTENTS = new Set(['charge', 'session'])

// a chain id may arrive as a number or as a decimal string; anything else is treated as absent
const readChainId = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) ? v : typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : null

/**
 * Reads who an MPP payment request would pay. Anything it cannot read with certainty is refused (fail closed).
 * Amounts are passed through as strings, whatever unit the method uses; only an amount of exactly "0" means no money moves.
 */
export function inspectChallenge(c: ChallengeLike, opts: { expectedChainId?: number } = {}): Inspection {
  if (c.method !== 'tempo') return { ok: false, reason: `unsupported payment method "${c.method}" (only tempo is checked)` }
  if (!SUPPORTED_INTENTS.has(c.intent)) return { ok: false, reason: `unsupported payment intent "${c.intent}" (only charge and session are checked)` }
  const req = c.request ?? {}
  const details = (req.methodDetails ?? {}) as { chainId?: unknown; splits?: unknown }
  const chainId = readChainId(details.chainId)
  if (opts.expectedChainId !== undefined && chainId !== null && chainId !== opts.expectedChainId) {
    return { ok: false, reason: `payment request is for chain ${chainId}, expected ${opts.expectedChainId}` }
  }
  const amount = String(req.amount ?? '')
  if (amount === '0') return { ok: true, free: true, chainId, recipients: [] }
  if (typeof req.recipient !== 'string' || !isAddress(req.recipient)) {
    return { ok: false, reason: 'payment request has no valid recipient to verify' }
  }
  const recipients: PaymentRecipient[] = [{ address: getAddress(req.recipient), role: 'primary', amount }]
  if (details.splits !== undefined) {
    if (!Array.isArray(details.splits)) return { ok: false, reason: 'payment request has malformed splits' }
    for (const s of details.splits as { recipient?: unknown; amount?: unknown }[]) {
      if (typeof s?.recipient !== 'string' || !isAddress(s.recipient)) return { ok: false, reason: 'payment request has a split with an invalid recipient' }
      recipients.push({ address: getAddress(s.recipient), role: 'split', amount: String(s.amount ?? '') })
    }
  }
  return { ok: true, free: false, chainId, recipients }
}

export type RecipientCheck = {
  recipient: PaymentRecipient
  /** null when the recipient was explicitly allowed or could not be verified */
  verdict: Verdict | null
  action: Action | null
  payee: { legalName: string; domain: string } | null
  /** true when the caller listed this address in allowRecipients */
  allowed: boolean
  /** set when the check itself failed */
  error?: string
}
export type GuardDecision = { allow: boolean; reason: string; checks: RecipientCheck[] }

const HARD_NO = new Set<Verdict>(['LOOKALIKE', 'CHANGED', 'REVOKED'])

/**
 * One decision over every recipient of a payment. The verdict decides, not the action: a check made without an org can
 * never produce PAY. LOOKALIKE, CHANGED and REVOKED always deny; CLOSE_MATCH and NO_MATCH follow onAsk (default block).
 */
export function decidePayment(checks: RecipientCheck[], opts: { onAsk?: 'block' | 'allow' } = {}): GuardDecision {
  if (checks.length === 0) return { allow: false, reason: 'nothing verified the recipient', checks }
  for (const c of checks) {
    const who = `${c.recipient.role === 'primary' ? 'recipient' : 'split recipient'} ${c.recipient.address}`
    if (c.allowed) continue
    if (c.error !== undefined || c.verdict === null) return { allow: false, reason: `could not verify ${who}: ${c.error ?? 'no verdict'}`, checks }
    if (HARD_NO.has(c.verdict)) return { allow: false, reason: `${who} is a ${c.verdict} wallet, not the verified one`, checks }
    if (c.verdict !== 'MATCH' && opts.onAsk !== 'allow') return { allow: false, reason: `${who} is not verified (${c.verdict})`, checks }
  }
  return { allow: true, reason: 'every recipient is verified', checks }
}
