import type { Metadata } from 'next'
import { NeedsCard } from '@/components/NeedsCard'
import { PageHead } from '@/components/PageHead'
import { wrap } from '@/components/ui'
import { OrgSetup } from './OrgSetup'

export const metadata: Metadata = { title: 'Payer dashboard' }

const NEEDS = [
  { label: 'Your company wallet', text: "It becomes the organization's root account. You sign the agent's key and every payee approval with it." },
  { label: 'A weekly spending limit', text: 'The most the agent can spend in a week. Tempo enforces it onchain.' },
  { label: 'A little stablecoin for fees', text: 'Tempo network fees are paid in stablecoin.' },
]

export default function AppPage() {
  return (
    <main className={`${wrap} flex flex-1 flex-col gap-8 py-8 sm:gap-12 sm:py-12`}>
      <PageHead
        title="Give your agent a key that can't pay a stranger."
        lede="Your AP agent gets its own Tempo access key with a spending limit. It can only pay companies you approve, and every approval is an onchain update you sign with your wallet. Bound never holds your wallet's keys."
      />
      <OrgSetup aside={<NeedsCard title="What you'll need" items={NEEDS} />} />
    </main>
  )
}
