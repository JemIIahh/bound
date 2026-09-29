import { tempo, tempoModerato } from 'viem/chains'

// Chain settings only (no wagmi import), so server components can use them too.
const network = process.env.NEXT_PUBLIC_TEMPO_NETWORK === 'mainnet' ? 'mainnet' : 'testnet'
export const token = network === 'mainnet' ? '0x20C000000000000000000000b9537d11c60E8b50' : '0x20c0000000000000000000000000000000000000'
export const chain = (network === 'mainnet' ? tempo : tempoModerato).extend({ feeToken: token as `0x${string}` })
export const explorer = network === 'mainnet' ? 'https://explore.tempo.xyz' : 'https://explore.testnet.tempo.xyz'

export const txUrl = (hash: string) => `${explorer}/tx/${hash}`
export const addressUrl = (address: string) => `${explorer}/address/${address}`
