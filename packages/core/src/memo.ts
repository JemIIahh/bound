import { keccak256, pad, stringToHex, type Hex } from 'viem'

/** 32-byte TIP-20 memo: ASCII right-padded when it fits, else keccak256 of the ref. */
export function memoFromInvoice(invoiceNo: string): Hex {
  const ref = invoiceNo.trim()
  const bytes = new TextEncoder().encode(ref)
  if (bytes.length <= 32) return pad(stringToHex(ref), { size: 32, dir: 'right' })
  return keccak256(stringToHex(ref))
}
