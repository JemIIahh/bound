'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useConnection } from 'wagmi'
import { ApiError, api, errorMessage, saveOrgToken, savedOrgIds, type CreatedOrg, type Hex, type Overview, type RootCall } from '@/lib/api'
import { txUrl } from '@/lib/chain'
import { usd } from '@/lib/format'
import { useNetworkCheck, useRootCall, type SendPhase } from '@/lib/hooks'
import { ConnectPanel } from '@/components/ConnectButton'
import { NetworkNotice } from '@/components/NetworkNotice'
import { Row } from '@/components/Row'
import { Stepper, type Step, type StepState } from '@/components/Stepper'
import { card, errorText, fieldClass, fieldLabel, ghostBtn, hint, primaryBtn, sectionLabel, short } from '@/components/ui'

const WEEK = 7 * 86400

/** A created org whose key isn't authorized yet survives reloads, keyed by the root wallet. */
type Setup = { orgId: string; name: string; limitUsd: string; agentKeyAddress: Hex; authorizeCall: RootCall; txHash?: Hex }
const setupKey = (wallet: string) => `bound.orgSetup.${wallet.toLowerCase()}`
function readSetup(wallet: string): Setup | null {
  try {
    const v = localStorage.getItem(setupKey(wallet))
    return v ? (JSON.parse(v) as Setup) : null
  } catch {
    return null
  }
}
function writeSetup(wallet: string, s: Setup | null) {
  try {
    if (s) localStorage.setItem(setupKey(wallet), JSON.stringify(s))
    else localStorage.removeItem(setupKey(wallet))
  } catch {
    // storage blocked: progress lasts for this page view only
  }
}

export function OrgSetup() {
  const router = useRouter()
  const { address, isConnected } = useConnection()
  const wallet = isConnected ? address : undefined
  const [setup, setSetup] = useState<Setup | null>(null)
  const net = useNetworkCheck()

  useEffect(() => {
    setSetup(wallet ? readSetup(wallet) : null)
  }, [wallet])

  const save = useCallback(
    (next: Setup | null) => {
      if (!wallet) return
      setSetup(next)
      writeSetup(wallet, next)
    },
    [wallet],
  )

  const flags = [!!wallet, !!setup, false]
  const active = flags.indexOf(false)
  const state = (i: number): StepState => (i < active ? 'done' : i === active ? 'active' : 'upcoming')

  const steps: Step[] = [
    {
      key: 'connect',
      title: 'Connect your wallet',
      state: state(0),
      summary: wallet ? short(wallet) : undefined,
      children: (
        <div className="flex flex-col gap-4">
          <p className="text-sm leading-relaxed text-ink">
            This wallet becomes your organization&apos;s root account. You&apos;ll sign the agent&apos;s key and every payee approval with it.
          </p>
          <ConnectPanel />
        </div>
      ),
    },
    {
      key: 'details',
      title: 'Your organization',
      state: state(1),
      summary: setup?.name,
      children: wallet ? <DetailsStep wallet={wallet} onCreated={save} /> : null,
    },
    {
      key: 'authorize',
      title: "Authorize the agent's key",
      state: state(2),
      children: setup ? (
        <AuthorizeStep
          setup={setup}
          blocked={net.mismatch}
          onSent={(txHash) => save({ ...setup, txHash })}
          onAuthorized={() => {
            // clear the stored progress without re-rendering the form, then open the dashboard
            if (wallet) writeSetup(wallet, null)
            router.push(`/app/${setup.orgId}`)
          }}
        />
      ) : null,
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <NetworkNotice check={net} />
      <SavedOrgs />
      <div className={card}>
        <div className="mb-6 flex items-center justify-between gap-3">
          <span className={sectionLabel}>New organization</span>
          <span className="font-mono text-[11px] text-graphite">
            Step {active + 1} of {steps.length}
          </span>
        </div>
        <Stepper steps={steps} />
        {setup && (
          <div className="mt-6 flex items-center justify-between gap-3 border-t border-black/10 pt-4 font-mono text-[11px] text-graphite">
            <span className="truncate">{setup.orgId}</span>
            <button onClick={() => save(null)} className="shrink-0 underline decoration-black/30 underline-offset-4 transition hover:text-ink">
              Start over
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function DetailsStep({ wallet, onCreated }: { wallet: string; onCreated: (s: Setup) => void }) {
  const [name, setName] = useState('')
  const [limitUsd, setLimitUsd] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setFields({})
    try {
      const created = await api<CreatedOrg>('/v1/orgs', {
        method: 'POST',
        json: { name: name.trim(), rootAddress: wallet, limitUsd: limitUsd.trim(), periodSeconds: WEEK },
      })
      saveOrgToken(created.org.id, created.token)
      onCreated({ orgId: created.org.id, name: created.org.name, limitUsd: limitUsd.trim(), agentKeyAddress: created.org.agentKeyAddress, authorizeCall: created.authorizeCall })
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setFields(err.fields)
      else setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <div>
        <label htmlFor="orgName" className={fieldLabel}>
          Company name
        </label>
        <input id="orgName" value={name} onChange={(e) => setName(e.target.value)} placeholder="Northwind Trading Ltd" autoComplete="organization" aria-invalid={!!fields.name} className={fieldClass} />
        {fields.name && <p className={`mt-1.5 ${errorText}`}>{fields.name}</p>}
      </div>
      <div>
        <label htmlFor="limitUsd" className={fieldLabel}>
          Weekly limit (USD)
        </label>
        <input
          id="limitUsd"
          value={limitUsd}
          onChange={(e) => setLimitUsd(e.target.value)}
          placeholder="5,000"
          inputMode="decimal"
          autoComplete="off"
          aria-invalid={!!fields.limitUsd}
          className={fieldClass}
        />
        {fields.limitUsd ? (
          <p className={`mt-1.5 ${errorText}`}>{fields.limitUsd}</p>
        ) : (
          <p className={`mt-1.5 ${hint}`}>The most the agent can spend in a week. Tempo enforces it onchain, whatever the agent is told.</p>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <button type="submit" disabled={busy || !name.trim() || !limitUsd.trim()} className={primaryBtn}>
          {busy ? 'Creating…' : 'Create organization'}
        </button>
        {error && <p className={errorText}>{error}</p>}
      </div>
    </form>
  )
}

function AuthorizeStep({ setup, blocked, onSent, onAuthorized }: { setup: Setup; blocked: boolean; onSent: (txHash: Hex) => void; onAuthorized: () => void }) {
  const send = useRootCall()
  const [phase, setPhase] = useState<'idle' | SendPhase | 'confirming'>('idle')
  const [error, setError] = useState<string | null>(null)
  const busy = phase !== 'idle'

  async function confirm(txHash: Hex) {
    setPhase('confirming')
    await api(`/v1/orgs/${encodeURIComponent(setup.orgId)}/authorized`, { method: 'POST', orgId: setup.orgId, json: { txHash } })
    onAuthorized()
  }

  async function run(fn: () => Promise<void>) {
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(errorMessage(e))
      setPhase('idle')
    }
  }

  const authorize = () =>
    run(async () => {
      const hash = await send(setup.authorizeCall, setPhase)
      onSent(hash)
      await confirm(hash)
    })

  const label = { idle: 'Authorize in wallet', switching: 'Switching to Tempo…', signing: 'Confirm in your wallet…', confirming: 'Confirming on Tempo…' }[phase]
  const limit = usd(tryBase(setup.limitUsd))

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-relaxed text-ink">
        One transaction from your wallet gives the agent its own key. Until you approve a payee, the key can only send money back to your own account.
      </p>
      <div>
        <Row label="Agent key">{short(setup.agentKeyAddress)}</Row>
        <Row label="Spending limit">{limit ? `${limit} per week` : `${setup.limitUsd} USD per week`}</Row>
        <Row label="Can pay">Only your account, for now</Row>
      </div>
      <div className="flex flex-col gap-2">
        <button onClick={authorize} disabled={busy || blocked} className={primaryBtn}>
          {label}
        </button>
        {setup.txHash && !busy && (
          <button onClick={() => run(() => confirm(setup.txHash!))} className={ghostBtn}>
            Check the sent transaction again
          </button>
        )}
        {setup.txHash && (
          <a href={txUrl(setup.txHash)} target="_blank" rel="noreferrer" className="self-start font-mono text-[11px] text-graphite underline decoration-black/30 underline-offset-4 hover:text-ink">
            Authorization {short(setup.txHash)} ↗
          </a>
        )}
        {error && <p className={errorText}>{error}</p>}
      </div>
    </div>
  )
}

/** "5,000" → base units, for display only; the server parses the real value. */
function tryBase(limitUsd: string): string | null {
  const m = /^\s*([\d,]+)(?:\.(\d{1,6}))?\s*$/.exec(limitUsd)
  if (!m) return null
  const whole = m[1]!.replace(/,/g, '')
  const frac = (m[2] ?? '').padEnd(6, '0')
  return BigInt(whole + frac).toString()
}

type SavedOrg = { id: string; name?: string; authorized?: boolean; failed?: boolean }

/** Orgs this browser holds a token for. */
function SavedOrgs() {
  const [orgs, setOrgs] = useState<SavedOrg[]>([])

  useEffect(() => {
    const ids = savedOrgIds()
    setOrgs(ids.map((id) => ({ id })))
    let cancelled = false
    for (const id of ids) {
      api<Overview>(`/v1/orgs/${encodeURIComponent(id)}/overview`, { orgId: id })
        .then((o) => !cancelled && setOrgs((all) => all.map((x) => (x.id === id ? { id, name: o.org.name, authorized: o.org.authorized } : x))))
        .catch(() => !cancelled && setOrgs((all) => all.map((x) => (x.id === id ? { id, failed: true } : x))))
    }
    return () => {
      cancelled = true
    }
  }, [])

  if (!orgs.length) return null
  return (
    <div className={card}>
      <span className={sectionLabel}>Your organizations</span>
      <ul className="mt-3 flex flex-col">
        {orgs.map((o, i) => (
          <li key={o.id} className={i ? 'border-t border-black/10' : ''}>
            <Link href={`/app/${o.id}`} className="group flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm text-ink group-hover:underline group-hover:decoration-black/30 group-hover:underline-offset-4">
                  {o.name ?? (o.failed ? 'Unavailable' : 'Loading…')}
                </p>
                <p className="truncate font-mono text-[11px] text-graphite">{o.id}</p>
              </div>
              <span className="flex shrink-0 items-center gap-3 font-mono text-[11px] text-graphite">
                {o.name && (o.authorized ? 'Key authorized' : 'Setup unfinished')}
                <span aria-hidden="true" className="text-ink">
                  →
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
