import type { Metadata } from 'next'
import { sectionLabel } from '@/components/ui'
import { PayeeOnboarding } from './PayeeOnboarding'

export const metadata: Metadata = { title: 'Get verified' }

const NEEDS = ["Your company's receiving wallet", "Access to your domain's DNS", 'An LEI, optional, for level 2']

export default function PayeePage() {
  return (
    <main className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 items-start gap-10 px-5 py-10 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-20">
      <section className="lg:sticky lg:top-10 lg:pt-6">
        <p className={`${sectionLabel} mb-6`}>For payees</p>
        <h1 className="font-display text-4xl font-medium leading-[1.12] tracking-[-0.02em] text-ink sm:text-5xl">Verify once. Every payer sees you.</h1>
        <p className="mt-6 max-w-md text-[15px] leading-relaxed text-graphite">
          Prove that your wallet belongs to your company. Payers who check your address, and the AI agents paying on their behalf, get a match
          instead of a warning.
        </p>
        <ul className="mt-9 flex flex-col gap-3 font-mono text-xs uppercase tracking-wider text-graphite">
          {NEEDS.map((n) => (
            <li key={n} className="flex items-center gap-3">
              <span className="h-px w-6 bg-ink/40" />
              {n}
            </li>
          ))}
        </ul>
      </section>
      <PayeeOnboarding />
    </main>
  )
}
