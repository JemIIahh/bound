/* eslint-disable @typescript-eslint/no-explicit-any -- mock EIP-1193 provider */
// Regression check: switching an unknown-network wallet to Tempo must succeed with MetaMask's rules.
// Run: pnpm --filter @bound/server exec tsx ../web/scripts/check-wallet-switch.mts
// Reproduces MetaMask's behavior for an unknown chain: wallet_switchEthereumChain fails with 4902,
// then wallet_addEthereumChain rejects any nativeCurrency.decimals other than 18.
import { connect, switchChain } from 'wagmi/actions'
import { injected } from 'wagmi'
import { createConfig, http } from 'wagmi'
import { wagmiChain } from '../lib/wagmi-chain'

;(globalThis as any).window = Object.assign(globalThis, { addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true } })
let added: any = null
let currentChain = '0x1'
const provider: any = {
  on() {}, removeListener() {},
  async request({ method, params }: any) {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return ['0x000000000000000000000000000000000000dEaD']
    if (method === 'eth_chainId') return currentChain
    if (method === 'wallet_switchEthereumChain') {
      if (!added) { const e: any = new Error('Unrecognized chain ID'); e.code = 4902; throw e }
      currentChain = params[0].chainId; return null
    }
    if (method === 'wallet_addEthereumChain') {
      const p = params[0]
      if (p.nativeCurrency && p.nativeCurrency.decimals !== 18) { const e: any = new Error(`Expected the number 18 for 'nativeCurrency.decimals' when 'nativeCurrency' is provided. Received: ${p.nativeCurrency.decimals}`); e.code = -32602; throw e }
      added = p; currentChain = p.chainId; return null
    }
    if (method === 'wallet_requestPermissions' || method === 'wallet_getPermissions') return []
    throw new Error('unsupported ' + method)
  },
}
const config = createConfig({ chains: [wagmiChain], connectors: [injected({ target: () => ({ id: 'mock', name: 'Mock', provider }) })], transports: { [wagmiChain.id]: http() } as any })
await connect(config, { connector: config.connectors[0]! })
try {
  await switchChain(config, { chainId: wagmiChain.id })
  console.log('PASS switched; added chain params:', JSON.stringify({ chainId: added?.chainId, decimals: added?.nativeCurrency?.decimals, rpc: added?.rpcUrls }))
} catch (e: any) {
  console.log('FAIL', e.shortMessage ?? e.message, '|', e.cause?.message ?? '')
  process.exit(1)
}
