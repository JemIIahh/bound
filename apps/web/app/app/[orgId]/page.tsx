import type { Metadata } from 'next'
import { Dashboard } from './Dashboard'

export const metadata: Metadata = { title: 'Dashboard' }

export default async function DashboardPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params
  return <Dashboard orgId={decodeURIComponent(orgId)} />
}
