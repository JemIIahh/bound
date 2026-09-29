'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ConnectButton } from './ConnectButton'

export function BoundMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2.75" y="2.75" width="18.5" height="18.5" rx="5" stroke="currentColor" strokeWidth="1.75" />
      <rect x="8.25" y="8.25" width="7.5" height="7.5" rx="1.75" fill="currentColor" />
    </svg>
  )
}

const LINKS = [
  { href: '/verify', label: 'Verify' },
  { href: '/payee', label: 'Get verified' },
]

/** Full-width top bar: brand on the left edge, links and the wallet control on the right edge. */
export function Nav() {
  const pathname = usePathname()
  return (
    <nav className="relative z-30 flex items-center justify-between gap-4 px-5 py-5 sm:px-8 sm:py-7">
      <Link href="/" className="flex items-center gap-2.5 text-lg tracking-tight text-ink">
        <BoundMark />
        Bound
      </Link>
      <div className="flex items-center gap-5">
        {LINKS.map((l) => {
          const active = pathname === l.href
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? 'page' : undefined}
              className={`hidden text-sm text-ink transition hover:opacity-50 sm:inline ${active ? 'underline decoration-1 underline-offset-4' : ''}`}
            >
              {l.label}
            </Link>
          )
        })}
        <ConnectButton />
      </div>
    </nav>
  )
}
