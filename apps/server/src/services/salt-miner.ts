import { VirtualMaster } from 'ox/tempo'
import type { Address, Hex } from 'viem'

/** Finds a TIP-1022 virtual-master salt for `wallet` (proof of work), searching up to 8 × 2^32 salts. */
export async function mineSalt(wallet: Address): Promise<{ salt: Hex; masterId: Hex }> {
  let start = 0n
  for (let round = 0; round < 8; round++) {
    const r = await VirtualMaster.mineSaltAsync({ address: wallet, start })
    if (r?.salt) return { salt: r.salt, masterId: r.masterId }
    start += 2n ** 32n
  }
  throw new Error('Salt mining exhausted 8 rounds')
}
