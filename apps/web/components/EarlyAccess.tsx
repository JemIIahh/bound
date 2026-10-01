'use client'

import { useState, type FormEvent } from 'react'
import { ApiError, api, errorMessage } from '@/lib/api'
import { CheckIcon } from './atoms'
import { card, cardTitle, errorText, fieldClass, primaryBtn } from './ui'

const ROLES = [
  { value: 'payer', label: 'Payer' },
  { value: 'supplier', label: 'Supplier' },
  { value: 'builder', label: 'Builder' },
  { value: 'other', label: 'Other' },
] as const
type Role = (typeof ROLES)[number]['value']

/** Landing-page sign-up for early access (POST /v1/signups). The server validates; a repeat email reads the same as a new one. */
export function EarlyAccess() {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role | ''>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api('/v1/signups', { method: 'POST', json: { email, role } })
      setDone(true)
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? 'Too many sign-ups from this network. Try again later.' : errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`${card} grid grid-cols-1 items-center gap-6 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)] min-[1100px]:gap-12`}>
      <div className="min-w-0">
        <h2 id="early-access" className={cardTitle}>
          Get early access
        </h2>
        <p className="mt-2 text-[15.5px] leading-[1.55] text-fg2">Bound runs on Tempo testnet today. Leave your email and we&apos;ll tell you when it goes live.</p>
      </div>
      {done ? (
        <div role="status" className="flex items-center gap-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ok text-card" aria-hidden="true">
            <CheckIcon size={14} />
          </span>
          <div className="min-w-0">
            <p className="text-[17px] font-semibold text-fg">You&apos;re on the list.</p>
            <p className="mt-0.5 text-[14.5px] text-fg2 [overflow-wrap:anywhere]">We&apos;ll write to {email.trim()} when Bound goes live.</p>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} noValidate aria-labelledby="early-access" className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_150px_auto]">
          <label htmlFor="eaEmail" className="sr-only">
            Work email
          </label>
          <input
            id="eaEmail"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            autoComplete="email"
            maxLength={254}
            aria-invalid={!!error}
            className={`${fieldClass} h-12 py-0`}
          />
          <label htmlFor="eaRole" className="sr-only">
            Your role
          </label>
          <div className="relative">
            <select
              id="eaRole"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className={`${fieldClass} h-12 cursor-pointer appearance-none py-0 pr-10 ${role ? '' : 'text-fg3'}`}
            >
              <option value="" disabled>
                I&apos;m a…
              </option>
              {ROLES.map((r) => (
                <option key={r.value} value={r.value} className="text-fg">
                  {r.label}
                </option>
              ))}
            </select>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-fg3">
              <path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <button type="submit" disabled={busy || !email.trim() || !role} className={`${primaryBtn} sm:w-auto`}>
            {busy ? 'Sending…' : 'Get early access'}
          </button>
          {error && <p className={`${errorText} sm:col-span-3`}>{error}</p>}
        </form>
      )}
    </div>
  )
}
