import type { Metadata } from 'next'
import { Lab } from './Lab'

export const metadata: Metadata = { title: 'Attack lab' }

export default async function LabPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params
  return <Lab orgId={decodeURIComponent(orgId)} />
}
