import type { Metadata } from 'next'
import { NeedsCard } from '@/components/NeedsCard'
import { PageHead } from '@/components/PageHead'
import { wrap } from '@/components/ui'
import { PayeeOnboarding } from './PayeeOnboarding'

export const metadata: Metadata = { title: 'Get verified' }

const NEEDS = [
  { label: "Your company's receiving wallet", text: 'The wallet your company is paid to. You sign with it; Bound never asks for funds or keys.' },
  { label: "Access to your domain's DNS", text: 'You add one TXT record to prove the domain is yours.' },
  { label: 'An LEI, optional', text: 'A Legal Entity Identifier raises your verification to level 2.' },
]

export default function PayeePage() {
  return (
    <main className={`${wrap} flex flex-1 flex-col gap-8 py-8 sm:gap-12 sm:py-12`}>
      <PageHead
        title="Verify once. Every payer sees you."
        lede="Prove that your wallet belongs to your company. Payers who check your address, and the AI agents paying on their behalf, get a match instead of a warning."
      />
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-6">
        <PayeeOnboarding />
        <NeedsCard title="What you'll need" items={NEEDS} note="Your progress is saved in this browser, so you can come back once your DNS record is live." />
      </div>
    </main>
  )
}
