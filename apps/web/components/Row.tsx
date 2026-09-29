import type { ReactNode } from 'react'

/** A figure row: label on the left, mono value on the right. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-1.5">
      <span className="shrink-0 text-sm text-graphite">{label}</span>
      <span className="min-w-0 text-right font-mono text-xs text-ink [overflow-wrap:anywhere]">{children}</span>
    </div>
  )
}

export const levelLabel = (level: number) => (level >= 2 ? 'Level 2 · legal entity (LEI)' : 'Level 1 · domain and wallet')
