'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError, api, errorMessage, type OrgEvent, type OrgInvoice } from '@/lib/api'
import { ago, usd } from '@/lib/format'
import { useOverview } from '@/lib/hooks'
import { PRESETS, type Preset } from '@/lib/presets'
import { Pill } from '@/components/atoms'
import { ResultPlaceholder, RunResult } from '@/components/LabRun'
import { NetworkNotice } from '@/components/NetworkNotice'
import { PageHead } from '@/components/PageHead'
import { StatusBadge } from '@/components/InvoiceStatus'
import { Badge } from '@/components/VerdictCard'
import { card, cardTitle, errorText, fieldClass, fieldLabel, hint, link, primaryBtn, short, smallBtn, wrap } from '@/components/ui'
import { OrgGate } from '../OrgChrome'

type RunMeta = { preset: Preset['key'] | null; guardOff: boolean }
const runsKey = (orgId: string) => `bound.labRuns.${orgId}`

function readRuns(orgId: string): Record<string, RunMeta> {
  try {
    return JSON.parse(sessionStorage.getItem(runsKey(orgId)) ?? '{}') as Record<string, RunMeta>
  } catch {
    return {}
  }
}
function writeRuns(orgId: string, runs: Record<string, RunMeta>) {
  try {
    sessionStorage.setItem(runsKey(orgId), JSON.stringify(runs))
  } catch {
    // storage blocked: run labels last for this page view only
  }
}

export function Lab({ orgId }: { orgId: string }) {
  const state = useOverview(orgId)
  const o = state.data
  const [presetKey, setPresetKey] = useState<Preset['key'] | null>(null)
  const [text, setText] = useState('')
  const [guardOff, setGuardOff] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [labDisabled, setLabDisabled] = useState(false)
  const [runs, setRuns] = useState<Record<string, RunMeta>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const resultRef = useRef<HTMLDivElement>(null)

  useEffect(() => setRuns(readRuns(orgId)), [orgId])

  useEffect(() => {
    if (selected && window.matchMedia('(max-width: 1023px)').matches) resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [selected])

  if (!o) return <OrgGate orgId={orgId} state={state} />

  const preset = PRESETS.find((p) => p.key === presetKey) ?? null
  const labRuns = o.invoices.filter((i) => i.lab === 1)

  function load(p: Preset) {
    setPresetKey(p.key)
    setText(p.text)
    setGuardOff(p.guardOff)
    setError(null)
  }

  async function run(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { invoiceId } = await api<{ invoiceId: string }>(`/v1/lab/${encodeURIComponent(orgId)}/run`, { method: 'POST', orgId, json: { text, guardOff } })
      // the preset label only applies while the text is still the preset's
      const next = { ...runs, [invoiceId]: { preset: preset && text === preset.text ? preset.key : null, guardOff } }
      setRuns(next)
      writeRuns(orgId, next)
      setSelected(invoiceId)
      void state.refresh()
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setLabDisabled(true)
      else setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className={`${wrap} flex flex-1 flex-col gap-8 py-8 sm:gap-12 sm:py-12`}>
      <PageHead
        title="Try to make your agent pay a stranger."
        lede={
          <>
            Send the agent an invoice an attacker wrote. With the guard on, Bound checks the payee before any money moves. Switch the guard off and the agent sends
            whatever it&apos;s told. Tempo still refuses any wallet you never approved.
          </>
        }
      >
        <p className="flex flex-wrap gap-x-5 gap-y-1 text-[14px] text-fg3">
          <span>{o.org.name}</span>
          <span>
            Agent key <span className="font-mono text-[12.5px]">{short(o.org.agentKeyAddress)}</span>
          </span>
          <span>{o.capacity.used} allowlisted</span>
          <Link href={`/app/${o.org.id}`} className={link}>
            Dashboard
          </Link>
        </p>
      </PageHead>

      <NetworkNotice check={state.network} />

      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2 lg:gap-6">
        {labDisabled ? (
          <div className={`${card} flex min-w-0 flex-col gap-4`} role="status">
            <div>
              <Pill tone="amber">Attack lab</Pill>
            </div>
            <p className={`mt-2 ${cardTitle}`}>Attack lab is disabled on this network</p>
            <p className="text-[15px] leading-relaxed text-fg2">The server only runs the lab on testnet, unless it was started with the lab enabled.</p>
          </div>
        ) : (
          <form onSubmit={run} className={`${card} flex min-w-0 flex-col gap-6`} noValidate>
            <div className="flex items-center justify-between gap-4">
              <Pill>Attack lab</Pill>
              <span className="text-[15px] text-fg3">{guardOff ? 'Guard off' : 'Guard on'}</span>
            </div>
            <div className="flex flex-col gap-3">
              <h2 className={cardTitle}>Write the scam</h2>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Presets">
                {PRESETS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => load(p)}
                    disabled={!!p.missing}
                    title={p.missing ? `Set ${p.missing} to use this preset` : undefined}
                    aria-pressed={presetKey === p.key}
                    className={`${smallBtn} aria-pressed:border-fg aria-pressed:bg-fg aria-pressed:text-ink`}
                  >
                    {p.title}
                  </button>
                ))}
              </div>
              {preset ? <p className="text-[14.5px] leading-relaxed text-fg2">{preset.about}</p> : <p className={hint}>Pick a preset, or write your own invoice.</p>}
              {PRESETS.some((p) => p.missing) && (
                <p className={hint}>
                  Some presets need their wallet set: {Array.from(new Set(PRESETS.filter((p) => p.missing).map((p) => p.missing))).join(', ')}.
                </p>
              )}
            </div>

            <div className="flex flex-1 flex-col">
              <label htmlFor="labText" className={fieldLabel}>
                Invoice
              </label>
              <textarea
                id="labText"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={12}
                placeholder="From: …&#10;Invoice …&#10;Pay to (Tempo): 0x…"
                className={`${fieldClass} flex-1 resize-y text-[13px] leading-relaxed`}
              />
            </div>

            <GuardSwitch off={guardOff} onChange={setGuardOff} />

            <div className="flex flex-col gap-2">
              <button type="submit" disabled={busy || !text.trim()} className={primaryBtn}>
                {busy ? 'Starting…' : guardOff ? 'Run with the guard off' : 'Run the agent'}
              </button>
              {error && <p className={errorText}>{error}</p>}
            </div>
          </form>
        )}

        <div ref={resultRef} className="flex min-w-0 scroll-mt-6 flex-col">
          {selected ? (
            <RunResult
              key={selected}
              id={selected}
              path={`/v1/orgs/${encodeURIComponent(orgId)}/invoices/${encodeURIComponent(selected)}`}
              orgId={orgId}
              title={PRESETS.find((x) => x.key === runs[selected]?.preset)?.title}
              guardOff={runs[selected]?.guardOff}
              approvalHref={`/app/${orgId}`}
            />
          ) : (
            <ResultPlaceholder />
          )}
        </div>
      </div>

      <section className={`${card} min-w-0`} aria-labelledby="runs-label">
        <div className="flex items-center justify-between gap-4">
          <h2 id="runs-label" className={cardTitle}>
            Runs
          </h2>
          {labRuns.length > 0 && <span className="text-[15px] text-fg3">{labRuns.length}</span>}
        </div>
        {labRuns.length === 0 ? (
          <p className="mt-4 text-[15px] text-fg2">No lab runs yet. Each run shows its own result here; lab runs don&apos;t count toward the dashboard totals.</p>
        ) : (
          <ul className="mt-4 flex flex-col">
            {labRuns.map((inv) => (
              <RunRow
                key={inv.id}
                inv={inv}
                events={o.events.filter((e) => e.invoiceId === inv.id)}
                meta={runs[inv.id]}
                active={selected === inv.id}
                onSelect={() => setSelected(inv.id)}
              />
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

function GuardSwitch({ off, onChange }: { off: boolean; onChange: (off: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-line2 pt-6">
      <div className="min-w-0">
        <p id="guard-label" className="text-[15px] font-semibold text-fg">
          Guard off
        </p>
        <p className={`mt-1 ${hint}`}>Skip Bound&apos;s checks. The agent sends the payment directly, and only Tempo&apos;s key rules remain.</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={off}
        aria-labelledby="guard-label"
        onClick={() => onChange(!off)}
        className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition ${off ? 'bg-acc' : 'bg-[#2A2E36]'}`}
      >
        <span className={`absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full transition-all ${off ? 'left-[24px] bg-[#140700]' : 'left-[4px] bg-fg3'}`} />
      </button>
    </div>
  )
}

function RunRow({ inv, events, meta, active, onSelect }: { inv: OrgInvoice; events: OrgEvent[]; meta: RunMeta | undefined; active: boolean; onSelect: () => void }) {
  const p = meta?.preset ? PRESETS.find((x) => x.key === meta.preset) : undefined
  const info = [inv.invoiceNo, usd(inv.amountBase), meta?.guardOff ? 'Guard off' : null, ago(inv.createdAt)].filter(Boolean).join(' · ')
  return (
    <li className="border-t border-line2">
      <button
        onClick={onSelect}
        aria-current={active ? 'true' : undefined}
        className={`-mx-3 flex w-[calc(100%+24px)] items-center justify-between gap-4 rounded-2xl px-3 py-4 text-left transition hover:bg-raised ${active ? 'bg-raised' : ''}`}
      >
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-fg [overflow-wrap:anywhere]">{p?.title ?? inv.payeeName ?? 'Custom invoice'}</p>
          <p className="mt-0.5 text-[13px] text-fg3">{info}</p>
        </div>
        {events.some((e) => e.kind === 'chain_rejected') ? (
          <Badge tone="red">Rejected by Tempo</Badge>
        ) : events.some((e) => e.kind === 'blocked' && e.detail?.reason === 'lab_gate') ? (
          <Badge tone="grey">Not sent</Badge>
        ) : (
          <StatusBadge status={inv.status} />
        )}
      </button>
    </li>
  )
}
