import type { Metadata } from 'next'
import { JetBrains_Mono, Schibsted_Grotesk } from 'next/font/google'
import { Providers } from './providers'
import { Nav } from '@/components/Nav'
import { chain } from '@/lib/chain'
import './globals.css'

const sans = Schibsted_Grotesk({ variable: '--font-schibsted', subsets: ['latin'] })
const mono = JetBrains_Mono({ variable: '--font-jetbrains', subsets: ['latin'] })

export const metadata: Metadata = {
  title: { default: 'Bound', template: '%s · Bound' },
  description: "Your AI can't pay a stranger. Payee verification for stablecoin payments on Tempo.",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${mono.variable} antialiased`}>
        <Providers>
          <div className="flex min-h-screen flex-col">
            <Nav />
            <div className="flex flex-1 flex-col">{children}</div>
            <footer className="mx-auto w-full max-w-6xl px-5 sm:px-8">
              <div className="h-px bg-black/12" />
              <div className="flex flex-col items-start justify-between gap-2 py-5 font-mono text-[11px] text-graphite sm:flex-row sm:items-center">
                <span>Payee verification for stablecoin payments · {chain.name}</span>
                <span>Bound ©2026</span>
              </div>
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  )
}
