'use client'

import { useEffect, useRef, useState } from 'react'
import { useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain, type Connector } from 'wagmi'
import { chain } from '@/lib/wagmi'
import { errorMessage } from '@/lib/api'
import { errorText, primaryBtn, short } from './ui'

/** Wallets to offer: EIP-6963 announced wallets, else the generic injected provider. */
function useWalletConnect() {
  const connectors = useConnectors()
  const discovered = connectors.filter((c) => c.id !== 'injected')
  const options = discovered.length ? discovered : connectors
  const { mutate, isPending, error, reset } = useConnect()
  const connect = (connector: Connector) => mutate({ connector })
  const message = error
    ? (error as { name?: string }).name === 'ProviderNotFoundError'
      ? 'No browser wallet found. Install a wallet such as MetaMask, then reload.'
      : errorMessage(error)
    : null
  return { options, connect, pending: isPending, error: message, reset }
}

const walletName = (c: Connector) => (c.id === 'injected' ? 'Browser wallet' : c.name)

function WalletIcon({ connector }: { connector: Connector }) {
  if (connector.icon) {
    // eslint-disable-next-line @next/next/no-img-element -- EIP-6963 icons are data URIs
    return <img src={connector.icon} alt="" className="h-5 w-5 rounded" />
  }
  return <span className="h-5 w-5 rounded border border-black/15 bg-white" aria-hidden="true" />
}

/** True when a wallet is connected but not on the configured Tempo chain. */
export function useWrongNetwork() {
  const { isConnected, chainId } = useConnection()
  return isConnected && chainId !== chain.id
}

/** Header control: connect (asks which wallet when several are installed), switch to Tempo, disconnect. */
export function ConnectButton() {
  const { address, isConnected } = useConnection()
  const wrongNetwork = useWrongNetwork()
  const { mutate: disconnect } = useDisconnect()
  const { mutate: switchChain, isPending: switching } = useSwitchChain()
  const { options, connect, pending, error, reset } = useWalletConnect()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (isConnected) setOpen(false)
  }, [isConnected])

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-2">
        {wrongNetwork ? (
          <button
            onClick={() => switchChain({ chainId: chain.id })}
            disabled={switching}
            className="flex h-9 items-center gap-2 whitespace-nowrap rounded-full border border-black/15 bg-white/60 px-3.5 text-xs text-ink transition hover:bg-black/5 disabled:opacity-40"
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-600" />
            {switching ? 'Switching…' : 'Switch to Tempo'}
          </button>
        ) : (
          <div className="flex h-9 items-center gap-2.5 whitespace-nowrap rounded-full border border-black/15 bg-white/60 px-3.5 font-mono text-xs text-ink">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-ink" />
            {short(address)}
          </div>
        )}
        <button
          onClick={() => disconnect()}
          title="Disconnect"
          aria-label="Disconnect"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-black/15 bg-white/60 text-graphite transition hover:bg-black/5 hover:text-ink"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </div>
    )
  }

  const choose = options.length > 1
  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => {
          reset()
          if (choose) setOpen((o) => !o)
          else if (options[0]) {
            setOpen(true)
            connect(options[0])
          }
        }}
        disabled={pending}
        aria-haspopup={choose ? 'menu' : undefined}
        aria-expanded={choose ? open : undefined}
        className="h-9 whitespace-nowrap rounded-full border border-black/15 bg-white/60 px-4 text-sm text-ink transition hover:bg-black/5 disabled:opacity-40"
      >
        {pending ? 'Connecting…' : 'Connect wallet'}
      </button>
      {open && (choose || error) && (
        <div
          role={choose ? 'menu' : undefined}
          className="absolute right-0 top-[calc(100%+10px)] z-20 w-[240px] overflow-hidden rounded-xl border border-black/12 bg-paper shadow-lg"
        >
          {choose &&
            options.map((c) => (
              <button
                key={c.uid}
                type="button"
                role="menuitem"
                onClick={() => connect(c)}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-ink transition hover:bg-black/5"
              >
                <WalletIcon connector={c} />
                {walletName(c)}
              </button>
            ))}
          {error && <p className={`px-3 py-2.5 ${choose ? 'border-t border-black/10' : ''} text-xs leading-relaxed text-red-700`}>{error}</p>}
        </div>
      )}
    </div>
  )
}

/** In-page connect: a full-width primary button, then the wallet list when several are installed. */
export function ConnectPanel() {
  const { options, connect, pending, error, reset } = useWalletConnect()
  const [choosing, setChoosing] = useState(false)
  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={() => {
          reset()
          if (options.length > 1) setChoosing((v) => !v)
          else if (options[0]) connect(options[0])
        }}
        disabled={pending}
        className={primaryBtn}
      >
        {pending ? 'Connecting…' : 'Connect wallet'}
      </button>
      {choosing &&
        options.length > 1 &&
        options.map((c) => (
          <button
            key={c.uid}
            onClick={() => connect(c)}
            disabled={pending}
            className="flex items-center gap-3 rounded-full border border-black/15 bg-white/40 px-4 py-2.5 text-left text-sm text-ink transition hover:bg-black/5 disabled:opacity-40"
          >
            <WalletIcon connector={c} />
            {walletName(c)}
          </button>
        ))}
      {error && <p className={errorText}>{error}</p>}
    </div>
  )
}
