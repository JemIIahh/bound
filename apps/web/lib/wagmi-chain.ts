import { chain } from './chain'

// The chain object handed to wagmi (and from there to the user's wallet).
// Tempo has no native gas coin; viem describes a 6-decimal "USD" placeholder, but MetaMask
// refuses wallet_addEthereumChain unless nativeCurrency.decimals is 18. The value is never
// used for amounts here (fees are paid in TIP-20 stablecoins), so present 18 to wallets.
export const wagmiChain = { ...chain, nativeCurrency: { ...chain.nativeCurrency, decimals: 18 } }
