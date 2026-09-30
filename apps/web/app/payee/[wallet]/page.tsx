import { cache, type ReactNode } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { API_URL, type Payee } from '@/lib/api'
import { addressUrl } from '@/lib/chain'
import { Addr, Avatar, CardFoot, Pill, ShieldIcon } from '@/components/atoms'
import { PageHead } from '@/components/PageHead'
import { Row, levelLabel } from '@/components/Row'
import { Badge } from '@/components/VerdictCard'
import { card, cardTitle, ghostBtn, link, primaryBtn, short, wrap } from '@/components/ui'

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
    <main className={`${wrap} flex flex-1 flex-col gap-8 py-8 sm:gap-12 sm:py-12`}>
      <PageHead title={title} lede={intro}>
        {badge && <div>{badge}</div>}
      </PageHead>
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
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-6">
          <div className={`${card} flex min-w-0 flex-col`}>
            <div className="flex items-center justify-between gap-4">
              <Pill tone={r.kind === 'missing' ? 'grey' : r.kind === 'invalid' ? 'amber' : 'grey'}>{r.kind === 'missing' ? 'Not verified' : r.kind === 'invalid' ? 'Invalid address' : 'Unavailable'}</Pill>
            </div>
            <h2 className={`mt-6 ${cardTitle}`}>Address</h2>
            <p className="mt-3 font-mono text-[13px] text-fg [overflow-wrap:anywhere] sm:text-sm">{wallet}</p>
            <CardFoot className="mt-auto pt-8" avatar={<Avatar name="?" flagged />} m1="No verified owner" m2={r.kind === 'invalid' ? 'not a Tempo address' : 'not in the Bound registry'} />
          </div>
          <div className={`${card} flex min-w-0 flex-col gap-4`}>
            <h2 className={cardTitle}>Paying this address?</h2>
            <p className="text-[15px] leading-relaxed text-fg2">Check it against the name on the invoice before any money moves.</p>
            <Link href={r.kind === 'invalid' ? '/verify' : `/verify?address=${encodeURIComponent(wallet)}`} className={`${primaryBtn} mt-auto`}>
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
    <Pill tone="green" icon={<ShieldIcon />}>
      Verified by Bound
    </Pill>
  )
  const intro = p.revokedAt
    ? `Bound revoked this verification on ${date(p.revokedAt)}. Don't pay this wallet as ${p.legalName}.`
    : p.supersededAt
      ? `${p.legalName} replaced this wallet on ${date(p.supersededAt)}. Payments should go to the new wallet.`
      : `This wallet belongs to ${p.legalName}, which proved control of ${p.domain}${p.level >= 2 ? ' and its legal entity identifier' : ''}.`
  const flagged = !!(p.revokedAt || p.supersededAt)

  return (
    <Layout title={p.legalName} badge={badge} intro={intro}>
      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-6">
        <div className={`${card} min-w-0`}>
          <div className="flex items-center justify-between gap-4">
            <Pill>Registry record</Pill>
            <span className="text-[15px] text-fg3">On Tempo</span>
          </div>
          <div className="mt-6">
            <Row label="Legal name">{p.legalName}</Row>
            <Row label="Domain">{p.domain}</Row>
            <Row label="LEI">{p.lei || '—'}</Row>
            <Row label="Level">{levelLabel(p.level)}</Row>
            <Row label="Invoice addresses">{hasMaster(p.masterId) ? p.masterId : 'Not set up'}</Row>
            <Row label="Active from">{date(p.activeFrom)}</Row>
            {p.supersededAt > 0 && <Row label="Replaced">{date(p.supersededAt)}</Row>}
            {p.successor && (
              <Row label="New wallet">
                <Link href={`/payee/${p.successor}`} className={link}>
                  {short(p.successor)}
                </Link>
              </Row>
            )}
            {p.revokedAt > 0 && <Row label="Revoked">{date(p.revokedAt)}</Row>}
          </div>
        </div>

        <div className={`${card} flex min-w-0 flex-col`}>
          <h2 className={cardTitle}>Wallet</h2>
          <p className="mt-3 font-mono text-[13px] leading-relaxed text-fg sm:text-sm">
            <Addr value={p.wallet} />
          </p>
          <CardFoot className="mt-6" avatar={<Avatar name={p.legalName} flagged={flagged} />} m1={`${p.legalName} · ${p.domain}`} m2={levelLabel(p.level)} />
          <div className="mt-auto flex flex-col gap-2 pt-8">
            <Link href={`/verify?address=${encodeURIComponent(p.wallet)}&name=${encodeURIComponent(p.legalName)}`} className={primaryBtn}>
              Check a payment to this wallet <span aria-hidden="true">→</span>
            </Link>
            <a href={addressUrl(p.wallet)} target="_blank" rel="noreferrer" className={ghostBtn}>
              View on Tempo Explorer ↗
            </a>
          </div>
        </div>
      </div>
    </Layout>
  )
}
