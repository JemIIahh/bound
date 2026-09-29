import { createClient, http, publicActions, walletActions, type Address } from 'viem'
import { Account } from 'viem/tempo'
import { getNetwork, publicClientFor, type NetworkName } from '@bound/core'
import type { Config } from './config'

export function createChain(config: Config) {
  const n = getNetwork(config.network as NetworkName)
  const pub = publicClientFor(config.network as NetworkName)
  const attesterAccount = Account.fromSecp256k1(config.attesterKey)
  const attester = createClient({ account: attesterAccount, chain: n.chain, transport: http(n.rpc) }).extend(publicActions).extend(walletActions)
  return { network: config.network as NetworkName, token: n.token as Address, pub, attester, explorer: n.explorer }
}
export type Chain = ReturnType<typeof createChain>
