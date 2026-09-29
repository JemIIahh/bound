import { createConfig, http, injected } from 'wagmi'
import { wagmiChain } from './wagmi-chain'

export { token, chain, explorer, txUrl, addressUrl } from './chain'
export const wagmiConfig = createConfig({ chains: [wagmiChain], connectors: [injected()], transports: { [wagmiChain.id]: http() } as Record<typeof wagmiChain.id, ReturnType<typeof http>>, ssr: true })

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig
  }
}
