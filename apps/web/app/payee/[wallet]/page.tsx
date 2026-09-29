import { cache, type ReactNode } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { API_URL, type Payee } from '@/lib/api'
import { addressUrl } from '@/lib/chain'
import { Row, levelLabel } from '@/components/Row'
import { Badge } from '@/components/VerdictCard'
import { card, ghostBtn, primaryBtn, sectionLabel, short } from '@/components/ui'

type Props = { params: Promise<{ wallet: string }> }
type Loaded = { kind: 'ok'; payee: Payee } | { kind: 'missing' } | { kind: 'invalid' } | { kind: 'error'; message: string }

const load = cache(async (wallet: string): Promise<Loaded> => {
  try {
    const res = await fetch(`${API_URL}/v1/payees/${encodeURIComponent(wallet)}`, { cache: 'no-store' })
    if (res.status === 404) return { kind: 'missing' }
    if (res.status === 400) return { kind: 'invalid' }
    if (!res.ok) return { kind: 'error', message: `The Bound API answered ${res.status}.` }
    return { kind: 'ok', payee: (await res.json()) as Payee }
  } catch {
    return { kind: 'error', message: "Can't reach the Bound API right now." }
  }
})

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { wallet } = await params
  const r = await load(wallet)
  return { title: r.kind === 'ok' ? r.payee.legalName : 'Payee profile' }
}

const date = (unix: number) => new Date(unix * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const hasMaster = (id: string) => !/^0x0*$/i.test(id)

function Layout({ title, badge, intro, children }: { title: string; badge?: ReactNode; intro: ReactNode; children: ReactNode }) {
  return (
    <main className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 items-start gap-10 px-5 py-10 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-20">
      <section className="lg:pt-6">
        <p className={`${sectionLabel} mb-6`}>Payee profile</p>
        <h1 className="font-display text-4xl font-medium leading-[1.12] tracking-[-0.02em] text-ink [overflow-wrap:anywhere] sm:text-5xl">{title}</h1>
        {badge && <div className="mt-5">{badge}</div>}
        <p className="mt-6 max-w-md text-[15px] leading-relaxed text-graphite">{intro}</p>
      </section>
      {children}
    </main>
  )
}

export default async function PayeeProfilePage({ params }: Props) {
  const { wallet } = await params
  const r = await load(wallet)

  if (r.kind !== 'ok') {
    const copy = {
      missing: { title: 'No verified payee', intro: "Bound has no verified company at this address. That doesn't make it unsafe, but no one has proven who owns it." },
      invalid: { title: 'Not a wallet address', intro: 'Check the link: a Tempo wallet address is 0x followed by 40 hex characters.' },
      error: { title: 'Profile unavailable', intro: r.kind === 'error' ? r.message : '' },
    }[r.kind]
    return (
      <Layout title={copy.title} intro={copy.intro}>
        <div className={`${card} flex flex-col gap-5`}>
          <div>
            <span className={sectionLabel}>Address</span>
            <p className="mt-2 font-mono text-[11px] text-ink [overflow-wrap:anywhere] sm:text-xs">{wallet}</p>
          </div>
          <div className="flex flex-col gap-2 border-t border-black/10 pt-5">
            <Link href={r.kind === 'invalid' ? '/verify' : `/verify?address=${encodeURIComponent(wallet)}`} className={primaryBtn}>
              Check a payment <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </Layout>
    )
  }

  const p = r.payee
  const badge = p.revokedAt ? (
    <Badge tone="red">Verification revoked</Badge>
  ) : p.supersededAt ? (
    <Badge tone="red">Wallet replaced</Badge>
  ) : (
    <Badge tone="green">Verified by Bound</Badge>
  )
  const intro = p.revokedAt
    ? `Bound revoked this verification on ${date(p.revokedAt)}. Don't pay this wallet as ${p.legalName}.`
    : p.supersededAt
      ? `${p.legalName} replaced this wallet on ${date(p.supersededAt)}. Payments should go to the new wallet.`
      : `This wallet belongs to ${p.legalName}, which proved control of ${p.domain}${p.level >= 2 ? ' and its legal entity identifier' : ''}.`

  return (
    <Layout title={p.legalName} badge={badge} intro={intro}>
      <div className={card}>
        <span className={sectionLabel}>Registry record</span>
        <div className="mt-3">
          <Row label="Legal name">{p.legalName}</Row>
          <Row label="Domain">{p.domain}</Row>
          <Row label="LEI">{p.lei || '—'}</Row>
          <Row label="Level">{levelLabel(p.level)}</Row>
          <Row label="Invoice addresses">{hasMaster(p.masterId) ? p.masterId : 'Not set up'}</Row>
          <Row label="Active from">{date(p.activeFrom)}</Row>
          {p.supersededAt > 0 && <Row label="Replaced">{date(p.supersededAt)}</Row>}
          {p.successor && (
            <Row label="New wallet">
              <Link href={`/payee/${p.successor}`} className="underline decoration-black/30 underline-offset-4 hover:decoration-ink">
                {short(p.successor)}
              </Link>
            </Row>
          )}
          {p.revokedAt > 0 && <Row label="Revoked">{date(p.revokedAt)}</Row>}
        </div>

        <div className="mt-5 border-t border-black/10 pt-4">
          <span className={sectionLabel}>Wallet</span>
          <p className="mt-2 font-mono text-[11px] text-ink [overflow-wrap:anywhere] sm:text-xs">{p.wallet}</p>
        </div>

        <div className="mt-5 flex flex-col gap-2 border-t border-black/10 pt-5">
          <Link href={`/verify?address=${encodeURIComponent(p.wallet)}&name=${encodeURIComponent(p.legalName)}`} className={primaryBtn}>
            Check a payment to this wallet <span aria-hidden="true">→</span>
          </Link>
          <a href={addressUrl(p.wallet)} target="_blank" rel="noreferrer" className={ghostBtn}>
            View on Tempo Explorer ↗
          </a>
        </div>
      </div>
    </Layout>
  )
}
