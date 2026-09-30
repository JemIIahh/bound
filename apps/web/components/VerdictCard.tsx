import Link from 'next/link'
import type { ReactNode } from 'react'
import type { Verdict, VerifyResult } from '@/lib/api'
import { ArrowIcon, Avatar, CardFoot, CheckIcon, CrossIcon, Pill, type Tone } from './atoms'
import { Row, levelLabel } from './Row'
import { card, cardTitle, link, roundBtn, sectionLabel, short } from './ui'

export type { Tone } from './atoms'

/** How each server verdict reads. Presentation only: the verdict itself always comes from the API. */
export const VERDICTS: Record<Verdict, { label: string; tone: Tone; summary: string }> = {
  MATCH: { label: 'Match', tone: 'green', summary: 'This address belongs to the company on the invoice.' },
  CLOSE_MATCH: { label: 'Close match', tone: 'amber', summary: 'Close, but not an exact match. Check the details before paying.' },
  NO_MATCH: { label: 'No match', tone: 'grey', summary: "Bound can't confirm this address belongs to the company on the invoice." },
  LOOKALIKE: { label: 'Lookalike', tone: 'red', summary: "This payment imitates a verified company. Don't pay it." },
  CHANGED: { label: 'Wallet changed', tone: 'red', summary: "This company's wallet changed recently. Hold the payment." },
  REVOKED: { label: 'Revoked', tone: 'red', summary: "This company's verification was revoked. Don't pay it." },
}

/** Status tag in one of the verdict colours. */
export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <Pill tone={tone}>{children}</Pill>
}

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const v = VERDICTS[verdict]
  return <Badge tone={v.tone}>{v.label}</Badge>
}

const ICON_BG: Record<Tone, string> = { green: 'bg-ok text-card', amber: 'bg-amber text-card', grey: 'bg-fg3 text-card', red: 'bg-acc text-[#140700]' }
const LINE_TEXT: Record<Tone, string> = { green: 'text-ok', amber: 'text-amber', grey: 'text-fg2', red: 'text-acc2' }

/** One-line verdict ("✓ Match — …") for compact cards. */
export function VerdictLine({ verdict }: { verdict: Verdict }) {
  const v = VERDICTS[verdict]
  return (
    <p className={`flex items-start gap-2 text-[15px] font-semibold leading-snug ${LINE_TEXT[v.tone]}`}>
      <span className={`mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full ${ICON_BG[v.tone]}`}>
        {v.tone === 'green' ? <CheckIcon /> : v.tone === 'red' ? <CrossIcon size={10} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      </span>
      <span>
        {v.label} — {v.summary}
      </span>
    </p>
  )
}

/**
 * The result of a payee check: verdict, the registered payee, "did you mean", and the reasons.
 * `framed={false}` drops the card chrome so it can sit inside another card (e.g. an approval).
 */
export function VerdictCard({ result, framed = true }: { result: VerifyResult; framed?: boolean }) {
  const v = VERDICTS[result.verdict]
  const p = result.payee
  const virtual = result.isVirtual && result.effectiveAddress.toLowerCase() !== result.address.toLowerCase()
  const flagged = v.tone === 'red'

  return (
    <div className={`flex min-w-0 flex-col ${framed ? card : ''}`} aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <VerdictBadge verdict={result.verdict} />
        {framed && result.checkId && <span className="font-mono text-[12.5px] text-fg3">{result.checkId}</span>}
      </div>
      <p className={`${framed ? `mt-6 ${cardTitle}` : 'mt-4 text-lg font-semibold leading-snug tracking-[-0.015em] text-fg'}`}>{v.summary}</p>
      {result.suggestedName && (
        <p className="mt-2 text-[15px] text-fg2">
          Did you mean <span className="font-semibold text-fg">{result.suggestedName}</span>?
        </p>
      )}

      <div className={`${framed ? 'mt-8 pt-6' : 'mt-5 pt-4'} border-t border-line2`}>
        <span className={sectionLabel}>Registered payee</span>
        {p ? (
          <div className="mt-2">
            <Row label="Name">{p.legalName}</Row>
            <Row label="Domain">{p.domain}</Row>
            {p.lei && <Row label="LEI">{p.lei}</Row>}
            <Row label="Level">{levelLabel(p.level)}</Row>
            <Row label="Wallet">
              <Link href={`/payee/${p.wallet}`} className={link}>
                {short(p.wallet)}
              </Link>
            </Row>
          </div>
        ) : (
          <p className="mt-2 text-[15px] text-fg2">No verified company is registered at this address.</p>
        )}
      </div>

      {result.reasons.length > 0 && (
        <div className={`${framed ? 'mt-6 pt-6' : 'mt-5 pt-4'} border-t border-line2`}>
          <span className={sectionLabel}>Reasons</span>
          <ul className="mt-3 flex flex-col gap-3">
            {result.reasons.map((r, i) => (
              <li key={`${r.code}-${i}`} className="flex gap-3">
                <span className={`mt-[9px] inline-block h-1.5 w-1.5 shrink-0 rounded-full ${flagged ? 'bg-acc' : 'bg-fg3'}`} />
                <div className="min-w-0">
                  <p className="text-[15px] leading-relaxed text-fg [overflow-wrap:anywhere]">{r.detail}</p>
                  <p className="font-mono text-[12px] text-fg3">{r.code}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {framed ? (
        <CardFoot
          className="mt-auto pt-8"
          avatar={<Avatar name={p?.legalName} flagged={!p || flagged} />}
          m1={p ? `${p.legalName} · ${p.domain}` : 'No verified owner'}
          m2={
            <>
              {short(result.address)}
              {virtual && <> → {short(result.effectiveAddress)}</>}
            </>
          }
          action={
            p ? (
              <Link href={`/payee/${p.wallet}`} aria-label={`Open ${p.legalName}'s profile`} className={roundBtn}>
                <ArrowIcon />
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line2 pt-4 font-mono text-[12px] text-fg3">
          <span>
            {short(result.address)}
            {virtual && <> → {short(result.effectiveAddress)}</>}
          </span>
          {result.checkId && <span>{result.checkId}</span>}
        </div>
      )}
    </div>
  )
}
