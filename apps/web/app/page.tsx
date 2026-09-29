import Link from 'next/link'
import { card, ghostBtn, primaryBtn, sectionLabel } from '@/components/ui'

const LINES = [
  'AI agents now pay supplier invoices in stablecoins, and one “we changed our wallet” email or lookalike address is all it takes.',
  'Bound verifies who owns a wallet (signature, domain, legal entity) and checks every payment against the name on the invoice.',
  "On Tempo, your agent's key can only pay companies you approved. Even a hijacked agent gets rejected by the chain.",
]

const ENTRIES = [
  { label: 'Anyone', text: 'Check an address against the name on an invoice.', href: '/verify', cta: 'Verify a payee', primary: true },
  { label: 'Suppliers', text: 'Prove your wallet and domain once. Every payer sees a match.', href: '/payee', cta: 'Get verified', primary: false },
  { label: 'Payers', text: 'Give your AP agent a key that only pays verified companies.', href: '/app', cta: 'Open the dashboard', primary: false },
]

export default function Home() {
  return (
    <main className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 items-center gap-12 px-5 py-10 sm:px-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-20">
      <section>
        <p className={`${sectionLabel} mb-7`}>Confirmation of payee · Tempo</p>
        <h1 className="font-display text-[2.75rem] font-medium leading-[1.12] tracking-[-0.02em] text-ink sm:text-[4.25rem]">
          Your AI can&apos;t pay a{' '}
          <span className="bg-ink px-2.5 pb-1 text-paper [-webkit-box-decoration-break:clone] [box-decoration-break:clone]">stranger</span>.
        </h1>
        <ol className="mt-9 flex max-w-lg flex-col gap-4">
          {LINES.map((line, i) => (
            <li key={line} className="flex gap-4 text-[15px] leading-relaxed text-graphite">
              <span className="w-5 shrink-0 pt-[3px] font-mono text-[11px] text-ink">0{i + 1}</span>
              <span>{line}</span>
            </li>
          ))}
        </ol>
      </section>

      <div className={`${card} flex flex-col`}>
        {ENTRIES.map((e, i) => (
          <div key={e.href} className={i === 0 ? 'pb-5' : 'border-t border-black/10 py-5 last:pb-0'}>
            <span className={sectionLabel}>{e.label}</span>
            <p className="mt-2 mb-4 text-sm leading-relaxed text-ink">{e.text}</p>
            <Link href={e.href} className={e.primary ? primaryBtn : ghostBtn}>
              {e.cta}
              {e.primary && <span aria-hidden="true">→</span>}
            </Link>
          </div>
        ))}
      </div>
    </main>
  )
}
