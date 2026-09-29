'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import { ApiError, api, errorMessage, type VerifyResult } from '@/lib/api'
import { VerdictCard } from '@/components/VerdictCard'
import { card, errorText, fieldClass, fieldLabel, hint, primaryBtn } from '@/components/ui'

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
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} className={`${card} flex flex-col gap-5`} noValidate>
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
            Sender domain <span className="text-graphite">(optional)</span>
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
        <div className="flex flex-col gap-2">
          <button type="submit" disabled={busy || !address.trim() || !payeeName.trim()} className={primaryBtn}>
            {busy ? 'Checking…' : 'Check payee'}
          </button>
          {error && <p className={errorText}>{error}</p>}
        </div>
      </form>

      {result && (
        <div ref={resultRef} className="scroll-mt-6">
          <VerdictCard result={result} />
        </div>
      )}
    </div>
  )
}
