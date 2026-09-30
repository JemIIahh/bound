import { Suspense } from 'react'
import type { Metadata } from 'next'
import { PageHead } from '@/components/PageHead'
import { wrap } from '@/components/ui'
import { VerifyForm } from './VerifyForm'

export const metadata: Metadata = { title: 'Verify a payee' }

export default function VerifyPage() {
  return (
    <main className={`${wrap} flex flex-1 flex-col gap-8 py-8 sm:gap-12 sm:py-12`}>
      <PageHead
        title="Check who you're paying."
        lede="Paste the address and the company name from an invoice. Bound checks them against the verified registry on Tempo and flags lookalike addresses, changed wallets and impersonation."
      />
      <Suspense>
        <VerifyForm />
      </Suspense>
    </main>
  )
}
