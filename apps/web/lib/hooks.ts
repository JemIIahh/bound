'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useConnection, useSendTransaction, useSwitchChain } from 'wagmi'
import { ApiError, api, errorMessage, readOrgToken, type Hex, type Overview, type RootCall } from './api'
import { chain } from './chain'

export type SendPhase = 'switching' | 'signing'

/** Sends a server-built call from the connected wallet (the org root), switching to Tempo first if needed. */
export function useRootCall() {
  const { chainId } = useConnection()
  const { mutateAsync: switchChainAsync } = useSwitchChain()
  const { mutateAsync: sendTransactionAsync } = useSendTransaction()
  return useCallback(
    async (call: RootCall, onPhase?: (p: SendPhase) => void): Promise<Hex> => {
      if (chainId !== chain.id) {
        onPhase?.('switching')
        await switchChainAsync({ chainId: chain.id })
      }
      onPhase?.('signing')
      return sendTransactionAsync({ to: call.to, data: call.data, chainId: chain.id })
    },
    [chainId, switchChainAsync, sendTransactionAsync],
  )
}

/** True when the connected wallet is the org's root account. */
export function useIsRoot(rootAddress: string | undefined) {
  const { address, isConnected } = useConnection()
  return { isRoot: !!(isConnected && address && rootAddress && address.toLowerCase() === rootAddress.toLowerCase()), isConnected, address }
}

export type OverviewState = {
  data: Overview | null
  /** 'no-token' when this browser has no token for the org; 'denied' when the API refused it (wrong token or no such org). */
  access: 'checking' | 'ok' | 'no-token' | 'denied'
  error: string | null
  refresh: () => Promise<void>
}

/** Polls `GET /v1/orgs/:orgId/overview` (default every 3 s), never overlapping requests. */
export function useOverview(orgId: string, intervalMs = 3000): OverviewState {
  const [data, setData] = useState<Overview | null>(null)
  const [access, setAccess] = useState<OverviewState['access']>('checking')
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)

  const refresh = useCallback(async () => {
    if (inFlight.current) return
    if (!readOrgToken(orgId)) {
      setAccess('no-token')
      return
    }
    inFlight.current = true
    try {
      const o = await api<Overview>(`/v1/orgs/${encodeURIComponent(orgId)}/overview`, { orgId })
      setData(o)
      setAccess('ok')
      setError(null)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setAccess('denied')
      else setError(errorMessage(e))
    } finally {
      inFlight.current = false
    }
  }, [orgId])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), intervalMs)
    return () => clearInterval(t)
  }, [refresh, intervalMs])

  return { data, access, error, refresh }
}
