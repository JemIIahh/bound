import type { ReactNode } from 'react'
import { pageLede, pageTitle } from './ui'

/** Page title row: headline on the left, the explanation (and optional extras) on the right. */
export function PageHead({ title, lede, children }: { title: ReactNode; lede?: ReactNode; children?: ReactNode }) {
  return (
    <header className="grid grid-cols-1 items-end gap-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:gap-10">
      <h1 className={`${pageTitle} [overflow-wrap:anywhere]`}>{title}</h1>
      {(lede || children) && (
        <div className="flex max-w-[480px] flex-col gap-4 md:justify-self-end">
          {lede && <p className={pageLede}>{lede}</p>}
          {children}
        </div>
      )}
    </header>
  )
}
