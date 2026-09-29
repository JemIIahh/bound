import { ERROR_SELECTORS } from './constants'

export type TempoErrorCode = 'CallNotAllowed' | 'SpendingLimitExceeded' | 'VirtualAddressUnregistered' | 'Other'

export function decodeTempoError(e: unknown): { code: TempoErrorCode; message: string } {
  const texts: string[] = []
  let cur: any = e
  for (let depth = 0; cur && depth < 8; depth++) {
    for (const k of ['shortMessage', 'message', 'details', 'data']) {
      const v = cur?.[k]
      if (typeof v === 'string') texts.push(v)
    }
    cur = cur.cause
  }
  const all = texts.join(' | ')
  for (const [code, sel] of Object.entries(ERROR_SELECTORS)) {
    if (all.includes(code) || all.toLowerCase().includes(sel)) return { code: code as TempoErrorCode, message: texts[0] ?? code }
  }
  return { code: 'Other', message: texts[0] ?? String(e) }
}
