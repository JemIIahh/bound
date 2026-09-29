'use client'

import { useState } from 'react'
import { api, errorMessage, type Approval, type Hex, type OrgInvoice, type PayResult, type PreparedApproval, type Verdict } from '@/lib/api'
import { txUrl } from '@/lib/chain'
import { usd } from '@/lib/format'
import { useIsRoot, useRootCall } from '@/lib/hooks'
import { VERDICTS, VerdictCard } from './VerdictCard'
import { card, errorText, ghostBtn, hint, primaryBtn, sectionLabel, short, smallBtn } from './ui'

/** Verdicts that are never approvable (the server refuses them too); no Approve button is rendered. */
const NEVER_APPROVE: ReadonlySet<Verdict> = new Set<Verdict>(['LOOKALIKE', 'CHANGED', 'REVOKED'])

type Phase = 'idle' | 'reviewing' | 'review' | 'preparing' | 'switching' | 'signing' | 'confirming' | 'rejecting' | 'done'

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => same(x, b[i]!))

const PAY_REASON: Record<string, string> = {
  over_limit: "Over the agent's spending limit — pay manually or raise the limit.",
  duplicate_invoice: 'Already paid: duplicate invoice.',
  needs_approval: 'Still needs approval.',
}

/**
 * One payee waiting for the finance lead. Approving signs an allowlist update with the org's ROOT wallet:
 * `/prepare` runs again immediately before the wallet opens (never an old one), the human sees the full list the
 * signature sets (incl. wallets carried from other pending approvals), then `/confirm { txHash }`.
 */
export function ApprovalCard({
  orgId,
  approval,
  invoice,
  rootAddress,
  labelFor,
  onChange,
  onDismiss,
}: {
  orgId: string
  approval: Approval
  invoice: OrgInvoice | undefined
  rootAddress: Hex
  /** Name for an allowlisted wallet (pins, other approvals), if known. */
  labelFor: (wallet: string) => string | undefined
  onChange: () => void
  onDismiss: () => void
}) {
  const { isRoot, isConnected } = useIsRoot(rootAddress)
  const send = useRootCall()
  const [phase, setPhase] = useState<Phase>('idle')
  const [prepared, setPrepared] = useState<PreparedApproval | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<Hex | null>(null)
  const [result, setResult] = useState<{ kind: 'approved'; payment: PayResult } | { kind: 'rejected' } | null>(null)

  const base = `/v1/orgs/${encodeURIComponent(orgId)}/approvals/${encodeURIComponent(approval.id)}`
  const verdict = approval.verdict?.verdict
  const approvable = !!verdict && !NEVER_APPROVE.has(verdict)
  const busy = phase !== 'idle' && phase !== 'review' && phase !== 'done'
  const amount = usd(invoice?.amountBase)

  const prepare = () => api<PreparedApproval>(`${base}/prepare`, { method: 'POST', orgId })

  async function run(fn: () => Promise<void>, fallback: Phase) {
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(errorMessage(e))
      setPhase(fallback)
    }
  }

  const review = () =>
    run(async () => {
      setNotice(null)
      setPhase('reviewing')
      setPrepared(await prepare())
      setPhase('review')
    }, 'idle')

  const sign = () =>
    run(async () => {
      setNotice(null)
      setPhase('preparing')
      // Prepare again right before the wallet opens: the list may have changed since the review.
      const fresh = await prepare()
      if (!prepared || !sameList(fresh.recipients, prepared.recipients)) {
        setPrepared(fresh)
        setNotice('The list changed since you reviewed it. Check it again before signing.')
        setPhase('review')
        return
      }
      setPrepared(fresh)
      const hash = await send(fresh.call, setPhase)
      setTxHash(hash)
      setPhase('confirming')
      const r = await api<{ approved: true; payment: PayResult }>(`${base}/confirm`, { method: 'POST', orgId, json: { txHash: hash } })
      setResult({ kind: 'approved', payment: r.payment })
      setPhase('done')
      onChange()
    }, 'review')

  // The update was sent but /confirm failed (e.g. not mined yet): check the same transaction again, never re-send.
  const confirmAgain = () =>
    run(async () => {
      if (!txHash) return
      setPhase('confirming')
      const r = await api<{ approved: true; payment: PayResult }>(`${base}/confirm`, { method: 'POST', orgId, json: { txHash } })
      setResult({ kind: 'approved', payment: r.payment })
      setPhase('done')
      onChange()
    }, 'review')

  const reject = () =>
    run(async () => {
      setPhase('rejecting')
      await api(`${base}/reject`, { method: 'POST', orgId })
      setResult({ kind: 'rejected' })
      setPhase('done')
      onChange()
    }, prepared ? 'review' : 'idle')

  const signLabel = {
    preparing: 'Preparing…',
    switching: 'Switching to Tempo…',
    signing: 'Confirm in your wallet…',
    confirming: 'Confirming on Tempo…',
  }[phase as string] ?? 'Sign allowlist update'

  const rootMessage = !isConnected
    ? `Connect this organization's root wallet (${short(rootAddress)}) to approve.`
    : !isRoot
      ? `The connected wallet isn't this organization's root account. Switch to ${short(rootAddress)} to approve.`
      : null

  return (
    <article className={card} aria-label={`Approval for ${approval.label}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className={sectionLabel}>{result?.kind === 'approved' ? 'Approved' : result?.kind === 'rejected' ? 'Rejected' : 'Approval needed'}</span>
        <span className="font-mono text-[11px] text-graphite">{[invoice?.invoiceNo, amount].filter(Boolean).join(' · ')}</span>
      </div>
      <p className="mt-2 font-display text-2xl tracking-[-0.01em] text-ink [overflow-wrap:anywhere]">{approval.label}</p>
      <p className="mt-1 font-mono text-[11px] text-graphite [overflow-wrap:anywhere]">{approval.wallet}</p>

      <div className="mt-5 border-t border-black/10 pt-5">
        {approval.verdict ? <VerdictCard result={approval.verdict} framed={false} /> : <p className="text-sm text-graphite">Bound has no stored check for this payee.</p>}
      </div>

      {result ? (
        <Outcome result={result} txHash={txHash} onDismiss={onDismiss} />
      ) : prepared && (phase === 'review' || busy) && phase !== 'rejecting' ? (
        <div className="mt-5 border-t border-black/10 pt-5">
          <span className={sectionLabel}>Your signature sets the allowlist to</span>
          <p className={`mt-2 ${hint}`}>
            Tempo replaces the agent key&apos;s whole recipient list with these {prepared.recipients.length} wallets. The agent can pay only them.
          </p>
          <ul className="mt-3 flex flex-col">
            {prepared.recipients.map((r, i) => {
              const isNew = same(r, approval.wallet)
              const carried = prepared.carried.some((c) => same(c, r))
              const label = isNew ? approval.label : same(r, rootAddress) ? 'Your root account' : labelFor(r)
              return (
                <li key={r} className={`flex flex-col gap-0.5 py-2.5 ${i ? 'border-t border-black/10' : ''}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="text-sm text-ink">{label ?? 'Allowlisted wallet'}</span>
                    {isNew && <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink">Adding</span>}
                  </div>
                  <span className="font-mono text-[11px] text-graphite [overflow-wrap:anywhere]">{r}</span>
                  {carried && (
                    <span className="mt-1 flex items-center gap-2 text-xs text-amber-900">
                      <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                      Also added because another approval is pending
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
          <div className="mt-4 flex flex-col gap-2">
            {notice && <p className="text-sm text-amber-900">{notice}</p>}
            {txHash && phase === 'review' ? (
              <button onClick={confirmAgain} className={primaryBtn}>
                Check the sent update again
              </button>
            ) : (
              <button onClick={sign} disabled={busy || !isRoot} className={primaryBtn}>
                {signLabel}
              </button>
            )}
            <button onClick={() => (setPrepared(null), setTxHash(null), setError(null), setPhase('idle'), setNotice(null))} disabled={busy} className={ghostBtn}>
              Cancel
            </button>
            {rootMessage && <p className={hint}>{rootMessage}</p>}
            {txHash && (
              <a href={txUrl(txHash)} target="_blank" rel="noreferrer" className="self-start font-mono text-[11px] text-graphite underline decoration-black/30 underline-offset-4 hover:text-ink">
                Allowlist update {short(txHash)} ↗
              </a>
            )}
            {error && <p className={errorText}>{error}</p>}
          </div>
        </div>
      ) : (
        <div className="mt-5 flex flex-col gap-2 border-t border-black/10 pt-5">
          {approvable ? (
            <>
              <p className={hint}>Approving adds this wallet to your agent key&apos;s allowlist on Tempo. You sign the update with your root wallet, then the agent pays the invoice.</p>
              <button onClick={review} disabled={busy || !isRoot} className={`${primaryBtn} mt-2`}>
                {phase === 'reviewing' ? 'Preparing…' : 'Approve'}
              </button>
              {rootMessage && <p className={hint}>{rootMessage}</p>}
            </>
          ) : (
            <p className="text-sm text-ink">
              {verdict ? `${VERDICTS[verdict].label} payees can't be approved.` : "This payee can't be approved."} Reject it so the agent doesn&apos;t pay.
            </p>
          )}
          <button onClick={reject} disabled={busy} className={approvable ? ghostBtn : `${primaryBtn} mt-2`}>
            {phase === 'rejecting' ? 'Rejecting…' : 'Reject'}
          </button>
          {error && <p className={errorText}>{error}</p>}
        </div>
      )}
    </article>
  )
}

function Outcome({ result, txHash, onDismiss }: { result: { kind: 'approved'; payment: PayResult } | { kind: 'rejected' }; txHash: Hex | null; onDismiss: () => void }) {
  let text: string
  let payTx: Hex | undefined
  if (result.kind === 'rejected') text = "Rejected. The agent won't pay this invoice."
  else if (result.payment.status === 'paid') {
    text = 'Approved and paid.'
    payTx = result.payment.txHash
  } else if (result.payment.status === 'failed' && result.payment.reason) text = `Approved. The payment didn't go through (${result.payment.reason.replace(/_/g, ' ')}).`
  else text = `Approved. ${PAY_REASON[result.payment.reason ?? ''] ?? `Payment ${result.payment.status}.`}`

  return (
    <div className="mt-5 flex flex-col gap-3 border-t border-black/10 pt-5">
      <p className="text-sm text-ink">{text}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-graphite">
        {txHash && (
          <a href={txUrl(txHash)} target="_blank" rel="noreferrer" className="underline decoration-black/30 underline-offset-4 hover:text-ink">
            Allowlist update {short(txHash)} ↗
          </a>
        )}
        {payTx && (
          <a href={txUrl(payTx)} target="_blank" rel="noreferrer" className="underline decoration-black/30 underline-offset-4 hover:text-ink">
            Payment {short(payTx)} ↗
          </a>
        )}
      </div>
      <div>
        <button onClick={onDismiss} className={smallBtn}>
          Dismiss
        </button>
      </div>
    </div>
  )
}
