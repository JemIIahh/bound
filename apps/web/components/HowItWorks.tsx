import Link from 'next/link'
import { ArrowIcon, LockIcon, Pill } from './atoms'
import { card, invCard, roundBtn } from './ui'

// The whole flow in plain words. It follows what the app really does: suppliers verify at /payee, a payer sets up at /app,
// and every invoice gets one of three outcomes (PAY / ASK / BLOCK in packages/core) with Tempo's allowlist as the backstop.
const STEPS = [
  {
    n: '1',
    who: 'Supplier · once',
    title: 'Your supplier proves their wallet',
    text: 'Acme signs with its wallet and adds one record to its website. Bound lists it publicly, so anyone can check it.',
    href: '/payee',
    cta: 'Get your company verified',
  },
  {
    n: '2',
    who: 'You · once',
    title: 'You give your agent a limited key',
    text: 'Your AI agent gets its own payment key with a weekly spending limit. It can only pay suppliers on your approved list, which starts empty.',
    href: '/app',
    cta: 'Set up your payer dashboard',
  },
  {
    n: '3',
    who: 'Every payment',
    title: 'Every invoice is checked first',
    text: 'Bound compares the invoice’s wallet with the public list before any money moves. A new supplier waits for your Approve; after that, they pay themselves.',
    href: '/verify',
    cta: 'Check a wallet',
  },
]

const OUTCOMES = [
  { dot: 'bg-ok', when: 'Verified, and you already approved them', then: 'Pays itself' },
  { dot: 'bg-amber', when: 'A new supplier, or not an exact match', then: 'Asks you first' },
  { dot: 'bg-acc', when: 'A lookalike, changed or revoked wallet', then: 'Blocked' },
]

export function HowItWorks({ wrap }: { wrap: string }) {
  return (
    <section id="how-it-works" className={`${wrap} scroll-mt-24 pb-20 pt-6 sm:pb-32 sm:pt-10`} aria-labelledby="how-title">
      <div className="grid grid-cols-1 items-end gap-4 md:grid-cols-2 md:gap-10">
        <h2 id="how-title" className="font-display text-[44px] font-extrabold leading-[0.96] tracking-[-0.045em] sm:text-[64px]">
          How it works. <span className="text-fg3">Three steps, then every invoice is checked.</span>
        </h2>
        <p className="max-w-[440px] text-[17px] text-fg2 md:justify-self-end">
          Suppliers prove their wallet once. You give your agent a limited key once. After that, nobody has to trust an email.
        </p>
      </div>

      <ol className="mt-8 grid grid-cols-1 gap-4 sm:mt-14 min-[1100px]:grid-cols-3 min-[1100px]:gap-6">
        {STEPS.map((s) => (
          <li key={s.n} className={`${card} flex min-w-0 flex-col`}>
            <div className="flex items-center justify-between gap-4">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-acc font-display text-lg font-extrabold text-[#140700]" aria-hidden="true">
                {s.n}
              </span>
              <Pill>{s.who}</Pill>
            </div>
            <h3 className="mt-8 text-2xl font-semibold leading-[1.12] tracking-[-0.025em] sm:mt-10 sm:text-[28px]">{s.title}</h3>
            <p className="mt-2 text-[15.5px] leading-[1.55] text-fg2">{s.text}</p>
            <div className="mt-auto flex items-center justify-between gap-4 pt-8 sm:pt-10">
              <span className="text-sm font-medium text-fg2">{s.cta}</span>
              <Link href={s.href} aria-label={s.cta} className={roundBtn}>
                <ArrowIcon />
              </Link>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-4 grid grid-cols-1 gap-4 min-[1100px]:mt-6 min-[1100px]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] min-[1100px]:gap-6">
        <div className={card}>
          <h3 className="text-2xl font-semibold leading-[1.12] tracking-[-0.025em] sm:text-[28px]">What happens to each invoice</h3>
          <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {OUTCOMES.map((o) => (
              <li key={o.then} className="flex flex-col gap-3 rounded-2xl border border-line2 bg-field p-4">
                <span className="flex items-center gap-2 text-[17px] font-semibold text-fg">
                  <i className={`inline-block h-2 w-2 shrink-0 rounded-full ${o.dot}`} aria-hidden="true" />
                  {o.then}
                </span>
                <span className="text-[14.5px] leading-snug text-fg2">{o.when}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className={`${invCard} flex flex-col justify-between gap-6`}>
          <span className="grid h-10 w-10 place-items-center rounded-full bg-ink text-cream" aria-hidden="true">
            <LockIcon size={15} />
          </span>
          <div>
            <h3 className="text-2xl font-semibold leading-[1.12] tracking-[-0.025em] sm:text-[28px]">And if something slips through?</h3>
            <p className="mt-2 text-[15.5px] leading-[1.55] text-fg2">Tempo refuses any wallet that isn&apos;t on your approved list, even with Bound switched off.</p>
          </div>
        </div>
      </div>
    </section>
  )
}
