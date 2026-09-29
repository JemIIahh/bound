import { getAddress, type Address, type Hex } from 'viem'
import type { ReadClient } from './networks'
import { Abis } from 'viem/tempo'
import { decodeVirtual } from '../address'
import { ADDRESS_REGISTRY } from './constants'

const ZERO = '0x0000000000000000000000000000000000000000'

export async function resolveRecipient(client: ReadClient, to: Address): Promise<{ effective: Address; isVirtual: boolean; masterId: Hex | null; registered: boolean }> {
  const v = decodeVirtual(to)
  if (!v) return { effective: getAddress(to), isVirtual: false, masterId: null, registered: true }
  const master = (await client.readContract({ address: ADDRESS_REGISTRY, abi: Abis.addressRegistry, functionName: 'getMaster', args: [v.masterId] })) as Address
  if (!master || master === ZERO) return { effective: getAddress(to), isVirtual: true, masterId: v.masterId, registered: false }
  return { effective: getAddress(master), isVirtual: true, masterId: v.masterId, registered: true }
}
