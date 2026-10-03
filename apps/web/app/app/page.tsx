import type { Metadata } from 'next'
import { NeedsCard } from '@/components/NeedsCard'
import { PageHead } from '@/components/PageHead'
import { wrap } from '@/components/ui'
import { OrgSetup } from './OrgSetup'

export const metadata: Metadata = { title: 'Payer dashboard' }

const NEEDS = [
  { label: 'Your company wallet', text: "It's the wallet that owns the agent's payment key. You sign the key and every supplier approval with it." },
  { label: 'A weekly spending limit', text: 'The most the agent can spend in a week. Tempo enforces it.' },
  { label: 'A little stablecoin for fees', text: 'Tempo network fees are paid in stablecoin.' },
]

export default function AppPage() {
  return (
    <main className={`${wrap} flex flex-1 flex-col gap-8 py-8 sm:gap-12 sm:py-12`}>
      <PageHead
        title="Give your agent a key that can't pay a stranger."
        lede="Your AP agent gets its own payment key with a weekly spending limit. It can only pay companies you approve, and every approval is a transaction you sign with your wallet on Tempo. Bound never holds your wallet's keys."
      />
      <OrgSetup aside={<NeedsCard title="What you'll need" items={NEEDS} />} />
    </main>
  )
}
