import Link from 'next/link'
import type { ReactNode } from 'react'
import type { Verdict, VerifyResult } from '@/lib/api'
import { Row, levelLabel } from './Row'
import { card, sectionLabel, short } from './ui'

export type Tone = 'green' | 'amber' | 'grey' | 'red'

const TONE: Record<Tone, { badge: string; dot: string }> = {
  green: { badge: 'border-emerald-700/25 bg-emerald-50 text-emerald-800', dot: 'bg-emerald-600' },
  amber: { badge: 'border-amber-700/30 bg-amber-50 text-amber-900', dot: 'bg-amber-500' },
  grey: { badge: 'border-black/15 bg-black/[0.04] text-graphite', dot: 'bg-graphite' },
  red: { badge: 'border-red-700/30 bg-red-50 text-red-800', dot: 'bg-red-600' },
}

/** How each server verdict reads. Presentation only: the verdict itself always comes from the API. */
export const VERDICTS: Record<Verdict, { label: string; tone: Tone; summary: string }> = {
  MATCH: { label: 'Match', tone: 'green', summary: 'This address belongs to the company on the invoice.' },
  CLOSE_MATCH: { label: 'Close match', tone: 'amber', summary: 'Close, but not an exact match. Check the details before paying.' },
  NO_MATCH: { label: 'No match', tone: 'grey', summary: "Bound can't confirm this address belongs to the company on the invoice." },
  LOOKALIKE: { label: 'Lookalike', tone: 'red', summary: "This payment imitates a verified company. Don't pay it." },
  CHANGED: { label: 'Wallet changed', tone: 'red', summary: "This company's wallet changed recently. Hold the payment." },
  REVOKED: { label: 'Revoked', tone: 'red', summary: "This company's verification was revoked. Don't pay it." },
}

/** Status pill in one of the verdict colours (the app's only accents). */
export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  const t = TONE[tone]
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.14em] ${t.badge}`}>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${t.dot}`} />
      {children}
    </span>
  )
}

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const v = VERDICTS[verdict]
  return <Badge tone={v.tone}>{v.label}</Badge>
}

/**
 * The result of a payee check: verdict, the registered payee, "did you mean", and the reasons.
 * `framed={false}` drops the card chrome so it can sit inside another card (e.g. an approval).
 */
export function VerdictCard({ result, framed = true }: { result: VerifyResult; framed?: boolean }) {
  const v = VERDICTS[result.verdict]
  const p = result.payee
  const virtual = result.isVirtual && result.effectiveAddress.toLowerCase() !== result.address.toLowerCase()

  return (
    <div className={`flex flex-col ${framed ? card : ''}`} aria-live="polite">
      <div>
        <VerdictBadge verdict={result.verdict} />
      </div>
      <p className="mt-4 font-display text-xl leading-snug tracking-[-0.01em] text-ink">{v.summary}</p>
      {result.suggestedName && (
        <p className="mt-2 text-sm text-graphite">
          Did you mean <span className="font-medium text-ink">{result.suggestedName}</span>?
        </p>
      )}

      <div className="mt-5 border-t border-black/10 pt-4">
        <span className={sectionLabel}>Registered payee</span>
        {p ? (
          <div className="mt-2">
            <Row label="Name">{p.legalName}</Row>
            <Row label="Domain">{p.domain}</Row>
            {p.lei && <Row label="LEI">{p.lei}</Row>}
            <Row label="Level">{levelLabel(p.level)}</Row>
            <Row label="Wallet">
              <Link href={`/payee/${p.wallet}`} className="underline decoration-black/30 underline-offset-4 hover:decoration-ink">
                {short(p.wallet)}
              </Link>
            </Row>
          </div>
        ) : (
          <p className="mt-3 text-sm text-graphite">No verified company is registered at this address.</p>
        )}
      </div>

      {result.reasons.length > 0 && (
        <div className="mt-5 border-t border-black/10 pt-4">
          <span className={sectionLabel}>Reasons</span>
          <ul className="mt-3 flex flex-col gap-3">
            {result.reasons.map((r, i) => (
              <li key={`${r.code}-${i}`} className="flex gap-3">
                <span className="mt-[9px] inline-block h-1 w-1 shrink-0 rounded-full bg-ink" />
                <div className="min-w-0">
                  <p className="text-sm leading-relaxed text-ink [overflow-wrap:anywhere]">{r.detail}</p>
                  <p className="font-mono text-[11px] text-graphite">{r.code}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-black/10 pt-4 font-mono text-[11px] text-graphite">
        <span>
          {short(result.address)}
          {virtual && <> → {short(result.effectiveAddress)}</>}
        </span>
        {result.checkId && <span>{result.checkId}</span>}
      </div>
    </div>
  )
}
