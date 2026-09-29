import type { Metadata } from 'next'
import Link from 'next/link'
import { Archivo, JetBrains_Mono } from 'next/font/google'
import { Providers } from './providers'
import { Nav } from '@/components/Nav'
import { Logo } from '@/components/atoms'
import { wrap } from '@/components/ui'
import './globals.css'

const sans = Archivo({ variable: '--font-archivo', subsets: ['latin'], axes: ['wdth'] })
const mono = JetBrains_Mono({ variable: '--font-jetbrains', subsets: ['latin'] })

export const metadata: Metadata = {
  title: { default: 'Bound', template: '%s · Bound' },
  description: "Your AI can't pay a stranger. Payee verification for stablecoin payments on Tempo.",
}

const FOOT_LINKS = [
  { href: '/app', label: 'For payers' },
  { href: '/payee', label: 'For suppliers' },
  { href: '/verify', label: 'Check a wallet' },
]

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${mono.variable} antialiased`}>
        <Providers>
          <div className="flex min-h-screen flex-col">
            <Nav />
            <div className="flex flex-1 flex-col">{children}</div>
            <footer className={wrap}>
              <div className="flex flex-col items-start gap-4 py-10 text-[15px] text-fg2 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:py-12">
                <Link href="/" aria-label="Bound home">
                  <Logo small />
                </Link>
                <nav aria-label="Footer" className="flex flex-wrap gap-x-8 gap-y-3">
                  {FOOT_LINKS.map((l) => (
                    <Link key={l.href} href={l.href} className="transition hover:text-fg">
                      {l.label}
                    </Link>
                  ))}
                </nav>
                <small className="text-sm text-fg3">© 2026 Bound. Built on Tempo.</small>
              </div>
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  )
}
