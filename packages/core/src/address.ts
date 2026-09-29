import type { Hex } from 'viem'

const VIRTUAL_MAGIC = 'fd'.repeat(10)
const hex = (a: string) => a.toLowerCase().replace(/^0x/, '')

/** TIP-1022 layout: masterId (4 bytes) | 0xfd × 10 | userTag (6 bytes). */
export function decodeVirtual(addr: string): { masterId: Hex; userTag: Hex } | null {
  const h = hex(addr)
  if (h.length !== 40 || h.slice(8, 28) !== VIRTUAL_MAGIC) return null
  return { masterId: `0x${h.slice(0, 8)}`, userTag: `0x${h.slice(28)}` }
}

export const isVirtualAddress = (addr: string) => decodeVirtual(addr) !== null

export function isLookalikeAddress(candidate: string, known: string, n = 4): boolean {
  const a = hex(candidate)
  const b = hex(known)
  if (a.length !== 40 || b.length !== 40 || a === b) return false
  return a.slice(0, n) === b.slice(0, n) && a.slice(-n) === b.slice(-n)
}

export function findLookalike<T extends { wallet: string }>(candidate: string, knowns: T[], exclude: string[] = []): T | null {
  const ex = new Set(exclude.map(hex))
  for (const k of knowns) {
    if (ex.has(hex(k.wallet))) continue
    if (isLookalikeAddress(candidate, k.wallet)) return k
  }
  return null
}
