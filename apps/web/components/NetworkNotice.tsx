import type { NetworkCheck } from '@/lib/hooks'

/**
 * Shown when this site (NEXT_PUBLIC_TEMPO_NETWORK) and the Bound server run on different Tempo networks.
 * Wallet transactions would go to one network and the server would read the other, so every signing button
 * stays disabled while this is up.
 */
export function NetworkNotice({ check }: { check: NetworkCheck }) {
  if (!check.mismatch) return null
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-2xl border border-red-700/40 bg-red-50/70 p-7 text-sm leading-relaxed">
      <p className="flex items-center gap-2.5 text-base text-red-800">
        <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-red-600" />
        Wrong network
      </p>
      <p className="text-ink">
        This site is set to <span className="font-mono text-[13px]">{check.web}</span> but the server runs{' '}
        <span className="font-mono text-[13px]">{check.server}</span> — transactions would go to the wrong network.
      </p>
      <p className="text-graphite">Signing is turned off until they match.</p>
    </div>
  )
}
