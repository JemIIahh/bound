import type { Metadata } from 'next'
import { TryDemo } from './TryDemo'

export const metadata: Metadata = {
  title: 'Try to make our AI pay a stranger',
  description: 'Write a scam invoice, switch our software off, and watch Tempo refuse the payment. No wallet needed.',
}

export default function TryPage() {
  return <TryDemo />
}
