import type { NetworkCheck } from '@/lib/hooks'

/**
 * Shown when this site (NEXT_PUBLIC_TEMPO_NETWORK) and the Bound server run on different Tempo networks.
 * Wallet transactions would go to one network and the server would read the other, so every signing button
 * stays disabled while this is up.
 */
export function NetworkNotice({ check }: { check: NetworkCheck }) {
  if (!check.mismatch) return null
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-card border border-acc/50 bg-acc/10 p-6 text-[15px] leading-relaxed sm:px-8">
      <p className="flex items-center gap-2.5 text-lg font-semibold text-acc2">
        <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-acc" />
        Wrong network
      </p>
      <p className="text-fg">
        This site is set to <span className="font-mono text-[13px]">{check.web}</span> but the server runs{' '}
        <span className="font-mono text-[13px]">{check.server}</span> — transactions would go to the wrong network.
      </p>
      <p className="text-fg2">Signing is turned off until they match.</p>
    </div>
  )
}
