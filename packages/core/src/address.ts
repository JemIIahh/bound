import type { Hex } from 'viem'
const VIRTUAL_MAGIC = 'fd'.repeat(10)
const hex = (a: string) => a.toLowerCase().replace(/^0x/, '')
/** TIP-1022 layout: masterId (4 bytes) | 0xfd × 10 | userTag (6 bytes). */
export function decodeVirtual(addr: string): { masterId: Hex; userTag: Hex } | null {
  const h = hex(addr)
  if (h.length !== 40 || h.slice(8, 28) !== VIRTUAL_MAGIC) return null
  return { masterId: `0x${h.slice(0, 8)}`, userTag: `0x${h.slice(28)}` }
}
