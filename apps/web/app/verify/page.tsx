import { Suspense } from 'react'
import type { Metadata } from 'next'
import { sectionLabel } from '@/components/ui'
import { VerifyForm } from './VerifyForm'

export const metadata: Metadata = { title: 'Verify a payee' }

export default function VerifyPage() {
  return (
    <main className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 items-start gap-10 px-5 py-10 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-20">
      <section className="lg:sticky lg:top-10 lg:pt-6">
        <p className={`${sectionLabel} mb-6`}>Payee check</p>
        <h1 className="font-display text-4xl font-medium leading-[1.12] tracking-[-0.02em] text-ink sm:text-5xl">Check who you&apos;re paying.</h1>
        <p className="mt-6 max-w-md text-[15px] leading-relaxed text-graphite">
          Paste the address and the company name from an invoice. Bound checks them against the verified registry on Tempo and flags lookalike
          addresses, changed wallets and impersonation.
        </p>
      </section>
      <Suspense>
        <VerifyForm />
      </Suspense>
    </main>
  )
}
