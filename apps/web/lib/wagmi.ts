import { createConfig, http, injected } from 'wagmi'
import { chain } from './chain'

export { token, chain, explorer, txUrl, addressUrl } from './chain'
export const wagmiConfig = createConfig({ chains: [chain], connectors: [injected()], transports: { [chain.id]: http() } as Record<typeof chain.id, ReturnType<typeof http>>, ssr: true })

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig
  }
}
