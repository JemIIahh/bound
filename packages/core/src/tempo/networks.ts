import { createPublicClient, http, type Address, type Hex } from 'viem'
import { tempo, tempoModerato } from 'viem/chains'

export type NetworkName = 'testnet' | 'mainnet'

const NETWORKS = {
  testnet: {
    name: 'testnet' as const,
    rpc: 'https://rpc.moderato.tempo.xyz',
    token: '0x20c0000000000000000000000000000000000000' as Address,
    explorer: 'https://explore.testnet.tempo.xyz',
    decimals: 6 as const,
    baseChain: tempoModerato,
  },
  mainnet: {
    name: 'mainnet' as const,
    rpc: 'https://rpc.tempo.xyz',
    token: '0x20C000000000000000000000b9537d11c60E8b50' as Address,
    explorer: 'https://explore.tempo.xyz',
    decimals: 6 as const,
    baseChain: tempo,
  },
}

export function getNetwork(name: NetworkName) {
  const n = NETWORKS[name]
  return { ...n, chain: n.baseChain.extend({ feeToken: n.token }) }
}

export function publicClientFor(name: NetworkName) {
  const n = getNetwork(name)
  return createPublicClient({ chain: n.chain, transport: http(n.rpc) })
}

/** Structural client types so any viem client (any chain generic) can be passed. */
export type ReadClient = { readContract: (args: any) => Promise<any> }
export type EstimateClient = { estimateGas: (args: any) => Promise<bigint> }

export const txUrl = (name: NetworkName, hash: Hex) => `${getNetwork(name).explorer}/tx/${hash}`
export const addressUrl = (name: NetworkName, addr: Address) => `${getNetwork(name).explorer}/address/${addr}`
