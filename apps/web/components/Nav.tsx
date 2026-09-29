'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ConnectButton } from './ConnectButton'
import { Logo } from './atoms'

const LINKS = [
  { href: '/app', label: 'For payers' },
  { href: '/payee', label: 'For suppliers' },
  { href: '/verify', label: 'Check a wallet' },
]

/** Top bar: wordmark and section links on the left, the wallet control on the right. */
export function Nav() {
  const pathname = usePathname()
  const home = pathname === '/'
  return (
    <div className={`relative z-30 ${home ? '' : 'border-b border-line2'}`}>
      <nav className="mx-auto flex h-16 w-full max-w-[1360px] items-center gap-10 px-4 sm:h-[76px] sm:px-8">
        <Link href="/" aria-label="Bound home" className="shrink-0">
          <Logo />
        </Link>
        <div className="hidden items-center gap-2 text-[15px] text-fg2 md:flex">
          {LINKS.map((l) => {
            const active = pathname === l.href || pathname.startsWith(`${l.href}/`)
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? 'page' : undefined}
                className={`rounded-full px-4 py-2 transition hover:text-fg ${active ? 'bg-raised text-fg' : ''}`}
              >
                {l.label}
              </Link>
            )
          })}
        </div>
        <div className="ml-auto flex items-center">
          <ConnectButton />
        </div>
      </nav>
    </div>
  )
}
