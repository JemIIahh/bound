'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import { ApiError, api, errorMessage, type VerifyResult } from '@/lib/api'
import { Pill } from '@/components/atoms'
import { VerdictCard } from '@/components/VerdictCard'
import { card, cardTitle, errorText, fieldClass, fieldLabel, hint, primaryBtn } from '@/components/ui'

export function VerifyForm() {
  const params = useSearchParams()
  const [address, setAddress] = useState(params.get('address') ?? '')
  const [payeeName, setPayeeName] = useState(params.get('name') ?? '')
  const [senderDomain, setSenderDomain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [result, setResult] = useState<VerifyResult | null>(null)
  const resultRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (result && window.matchMedia('(max-width: 1023px)').matches) resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [result])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setFields({})
    try {
      const body = { address: address.trim(), payeeName: payeeName.trim(), ...(senderDomain.trim() ? { senderDomain: senderDomain.trim() } : {}) }
      setResult(await api<VerifyResult>('/v1/verify', { method: 'POST', json: body }))
    } catch (err) {
      setResult(null)
      if (err instanceof ApiError && Object.keys(err.fields).length) setFields(err.fields)
      else setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2 lg:gap-6">
      <form onSubmit={submit} className={`${card} flex min-w-0 flex-col gap-6`} noValidate>
        <div className="flex items-center justify-between gap-4">
          <Pill>Payee check</Pill>
          <span className="text-[15px] text-fg3">No wallet needed</span>
        </div>
        <h2 className={cardTitle}>Paste the invoice details</h2>
        <div>
          <label htmlFor="address" className={fieldLabel}>
            Wallet address
          </label>
          <input
            id="address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="0x…"
            autoComplete="off"
            spellCheck={false}
            required
            aria-invalid={!!fields.address}
            className={fieldClass}
          />
          {fields.address && <p className={`mt-1.5 ${errorText}`}>{fields.address}</p>}
        </div>
        <div>
          <label htmlFor="payeeName" className={fieldLabel}>
            Payee name, as on the invoice
          </label>
          <input
            id="payeeName"
            value={payeeName}
            onChange={(e) => setPayeeName(e.target.value)}
            placeholder="Acme Ltd"
            autoComplete="off"
            required
            aria-invalid={!!fields.payeeName}
            className={fieldClass}
          />
          {fields.payeeName && <p className={`mt-1.5 ${errorText}`}>{fields.payeeName}</p>}
        </div>
        <div>
          <label htmlFor="senderDomain" className={fieldLabel}>
            Sender domain <span className="font-normal text-fg3">(optional)</span>
          </label>
          <input
            id="senderDomain"
            value={senderDomain}
            onChange={(e) => setSenderDomain(e.target.value)}
            placeholder="acme.com"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!!fields.senderDomain}
            className={fieldClass}
          />
          {fields.senderDomain ? (
            <p className={`mt-1.5 ${errorText}`}>{fields.senderDomain}</p>
          ) : (
            <p className={`mt-1.5 ${hint}`}>The domain the invoice email came from.</p>
          )}
        </div>
        <div className="mt-auto flex flex-col gap-2 pt-2">
          <button type="submit" disabled={busy || !address.trim() || !payeeName.trim()} className={primaryBtn}>
            {busy ? 'Checking…' : 'Check payee'}
          </button>
          {error && <p className={errorText}>{error}</p>}
        </div>
      </form>

      <div ref={resultRef} className="flex min-w-0 scroll-mt-6 flex-col">
        {result ? (
          <VerdictCard result={result} />
        ) : (
          <div className={`${card} flex flex-1 flex-col`} aria-live="polite">
            <div className="flex items-center justify-between gap-4">
              <Pill>Result</Pill>
              <span className="text-[15px] text-fg3">{busy ? 'Checking…' : 'Waiting for a check'}</span>
            </div>
            <p className={`mt-6 ${cardTitle} !text-fg3`}>The verdict shows here.</p>
            <ul className="mt-6 flex flex-col gap-3 text-[15px] text-fg2">
              <li className="flex items-center gap-3">
                <span className="h-2 w-2 shrink-0 rounded-full bg-ok" />
                Match — the wallet belongs to the company on the invoice
              </li>
              <li className="flex items-center gap-3">
                <span className="h-2 w-2 shrink-0 rounded-full bg-amber" />
                Close match — check the details before paying
              </li>
              <li className="flex items-center gap-3">
                <span className="h-2 w-2 shrink-0 rounded-full bg-fg3" />
                No match — nobody has proven they own it
              </li>
              <li className="flex items-center gap-3">
                <span className="h-2 w-2 shrink-0 rounded-full bg-acc" />
                Lookalike, changed or revoked — don&apos;t pay it
              </li>
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
