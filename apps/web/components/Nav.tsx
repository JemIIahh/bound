'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useConnection, useDisconnect } from 'wagmi'
import { ConnectButton } from './ConnectButton'
import { ArrowIcon, Logo } from './atoms'
import { primaryBtn } from './ui'

const LINKS = [
  { href: '/app', label: 'For payers' },
  { href: '/payee', label: 'For suppliers' },
  { href: '/verify', label: 'Check a wallet' },
]

/** Full-width top bar: logo on the left edge, section links beside it, the wallet control on the right edge. Below md the links move into a menu. */
export function Nav() {
  const pathname = usePathname()
  const home = pathname === '/'
  const [open, setOpen] = useState(false)
  const { isConnected } = useConnection()
  const { mutate: disconnect } = useDisconnect()
  const bar = useRef<HTMLDivElement>(null)
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`)

  // a new page closes the menu
  useEffect(() => setOpen(false), [pathname])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const onDown = (e: PointerEvent) => !bar.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [open])

  return (
    <div ref={bar} className={`relative z-30 ${home && !open ? '' : 'border-b border-line2'}`}>
      <nav className="flex h-16 w-full items-center gap-3 px-4 sm:h-[76px] sm:px-8 md:gap-10">
        <Link href="/" aria-label="Bound home" className="shrink-0">
          <Logo />
        </Link>
        <div className="hidden items-center gap-2 text-[15px] text-fg2 md:flex">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={isActive(l.href) ? 'page' : undefined}
              className={`rounded-full px-4 py-2 transition hover:text-fg ${isActive(l.href) ? 'bg-raised text-fg' : ''}`}
            >
              {l.label}
            </Link>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ConnectButton />
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line text-fg transition hover:border-edge md:hidden"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              {open ? <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" /> : <path d="M3 5.5h12M3 9h12M3 12.5h12" />}
            </svg>
          </button>
        </div>
      </nav>

      {open && (
        <div id="mobile-menu" className="tour-in absolute inset-x-0 top-full border-b border-line2 bg-bg/95 px-4 pb-5 pt-2 shadow-[0_24px_48px_-24px_rgba(0,0,0,0.9)] backdrop-blur-md sm:px-8 md:hidden">
          <nav aria-label="Main" className="flex flex-col">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                aria-current={isActive(l.href) ? 'page' : undefined}
                className={`flex items-center justify-between rounded-xl px-4 py-3.5 text-[17px] transition ${isActive(l.href) ? 'bg-raised text-fg' : 'text-fg2 hover:text-fg'}`}
              >
                {l.label}
                <ArrowIcon size={15} />
              </Link>
            ))}
          </nav>
          <Link href="/try" onClick={() => setOpen(false)} className={`${primaryBtn} mt-3 !h-auto min-h-12 py-3 text-center`}>
            Try to make our AI agent pay a stranger <ArrowIcon size={15} />
          </Link>
          {isConnected && (
            // below sm the wallet pill has no room for its disconnect button, so it lives here
            <button
              type="button"
              onClick={() => {
                disconnect()
                setOpen(false)
              }}
              className="mt-2 h-12 w-full rounded-btn text-[15px] font-semibold text-fg2 transition hover:text-fg sm:hidden"
            >
              Disconnect wallet
            </button>
          )}
        </div>
      )}
    </div>
  )
}
