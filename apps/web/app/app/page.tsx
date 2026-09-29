import type { Metadata } from 'next'
import { sectionLabel } from '@/components/ui'
import { OrgSetup } from './OrgSetup'

export const metadata: Metadata = { title: 'Payer dashboard' }

const NEEDS = ['Your company wallet (root account)', 'A weekly spending limit for the agent', 'A little stablecoin for network fees']

export default function AppPage() {
  return (
    <main className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 items-start gap-10 px-5 py-10 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-20">
      <section className="lg:sticky lg:top-10 lg:pt-6">
        <p className={`${sectionLabel} mb-6`}>For payers</p>
        <h1 className="font-display text-4xl font-medium leading-[1.12] tracking-[-0.02em] text-ink sm:text-5xl">Give your agent a key that can&apos;t pay a stranger.</h1>
        <p className="mt-6 max-w-md text-[15px] leading-relaxed text-graphite">
          Your AP agent gets its own Tempo access key with a spending limit. It can only pay companies you approve, and every approval is an onchain
          update you sign with your wallet. Bound never holds your wallet&apos;s keys.
        </p>
        <ul className="mt-9 flex flex-col gap-3 font-mono text-xs uppercase tracking-wider text-graphite">
          {NEEDS.map((n) => (
            <li key={n} className="flex items-center gap-3">
              <span className="h-px w-6 shrink-0 bg-ink/40" />
              {n}
            </li>
          ))}
        </ul>
      </section>
      <OrgSetup />
    </main>
  )
}
