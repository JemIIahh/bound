'use client'

import { useEffect } from 'react'
import { useConfig } from 'wagmi'
import { reconnect } from 'wagmi/actions'
import { WALLET_DROP_TEXT, setWalletDrop } from '@/lib/wallet-drop'

const WINDOW_MS = 10_000
const MAX_RESTORES = 2

/**
 * A wallet can report a dropped connection while it still holds the account. EIP-1193's `disconnect` event only means the
 * wallet lost its link to a network, yet wagmi (except for MetaMask's code 1013) treats it as the user leaving, so the
 * Connect button flips back right after a successful connect. When a connection ends and the wallet still authorizes the
 * account, restore it. A deliberate Disconnect sets wagmi's `<id>.disconnected` flag, which makes the restore a no-op.
 * If the wallet really has no account to give, say so instead of failing silently.
 */
export function WalletKeepAlive() {
  const config = useConfig()
  useEffect(() => {
    let restores: number[] = []
    return config.subscribe(
      (s) => ({ status: s.status, connector: s.current ? s.connections.get(s.current)?.connector : undefined }),
      async (now, prev) => {
        if (now.status === 'connected') return setWalletDrop(null)
        const connector = prev.connector
        if (prev.status !== 'connected' || now.status !== 'disconnected' || !connector) return

        const at = Date.now()
        restores = restores.filter((t) => at - t < WINDOW_MS)
        if (restores.length < MAX_RESTORES) {
          restores.push(at)
          const restored = await reconnect(config, { connectors: [connector] }).catch(() => [])
          if (restored.length) return
        }
        const left = await config.storage?.getItem(`${connector.id}.disconnected`)
        if (!left) setWalletDrop(WALLET_DROP_TEXT)
      },
      { equalityFn: (a, b) => a.status === b.status && a.connector === b.connector },
    )
  }, [config])
  return null
}
