import { useSyncExternalStore } from 'react'

/** Set when the wallet ended the connection on its own and it could not be restored; read by the connect controls. */
export const WALLET_DROP_TEXT = 'Your wallet closed the connection. Unlock it, make sure only one wallet extension is active, then connect again.'

let message: string | null = null
const listeners = new Set<() => void>()

export function setWalletDrop(next: string | null) {
  if (next === message) return
  message = next
  listeners.forEach((l) => l())
}

export function useWalletDrop() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => message,
    () => null,
  )
}
