import type { VerifyResult } from './verdict'

export type Action = 'PAY' | 'ASK' | 'BLOCK'

export function decideAction(r: VerifyResult): Action {
  if (r.verdict === 'LOOKALIKE' || r.verdict === 'CHANGED' || r.verdict === 'REVOKED') return 'BLOCK'
  if (r.reasons.some((x) => x.code === 'unregistered_virtual')) return 'BLOCK'
  if (r.allowlisted && (r.verdict === 'MATCH' || r.pinned)) return 'PAY'
  return 'ASK'
}
