import type { Metadata } from 'next'
import Link from 'next/link'
import { IBM_Plex_Mono, Outfit, Poppins } from 'next/font/google'
import { Providers } from './providers'
import { Nav } from '@/components/Nav'
import { Logo } from '@/components/atoms'
import { wrap } from '@/components/ui'
import './globals.css'

const display = Outfit({ variable: '--font-outfit', subsets: ['latin'] })
const sans = Poppins({ variable: '--font-poppins', subsets: ['latin'], weight: ['300', '400', '500', '600', '700'] })
const mono = IBM_Plex_Mono({ variable: '--font-plex-mono', subsets: ['latin'], weight: ['400', '500', '600'] })

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
    // font variables on <html>: the theme's --font-sans/--font-mono are declared on :root and must resolve there
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="antialiased">
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
