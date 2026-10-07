'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ApiError, api, errorMessage, type DemoStatus } from '@/lib/api'
import { network } from '@/lib/chain'
import { PRESETS, type Preset } from '@/lib/presets'
import { Pill } from '@/components/atoms'
import { ApiScenario } from '@/components/ApiRun'
import { ResultPlaceholder, RunResult } from '@/components/LabRun'
import { DemoNotice, Segmented, Switch, noticeFor, type Notice } from '@/components/DemoControls'
import { PageHead } from '@/components/PageHead'
import { card, cardTitle, errorText, fieldClass, hint, primaryBtn, smallBtn, wrap } from '@/components/ui'

/** Presets whose wallets this deployment has (NEXT_PUBLIC_LAB_*); the public page hides the rest. */
const AVAILABLE = PRESETS.filter((p) => !p.missing)

type Run = { id: string; title?: string; guardOff: boolean }
type Scenario = 'invoice' | 'api'

const SCENARIOS: { value: Scenario; label: string }[] = [
  { value: 'invoice', label: 'Pay an invoice' },
  { value: 'api', label: 'Buy data from a paid API' },
]

/** The public attack lab: no wallet, no org. Runs go to the server's demo company (POST /v1/demo/runs). */
export function TryDemo() {
  // which scenario is shown; nothing is remembered between visits
  const [scenario, setScenario] = useState<Scenario>('invoice')
  const [presetKey, setPresetKey] = useState<Preset['key'] | null>(null)
  const [text, setText] = useState('')
  const [softwareOn, setSoftwareOn] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  // the server's values replace these once GET /v1/demo answers
  const [limits, setLimits] = useState({ runsPerHour: 6, maxChars: 4000 })
  const [run, setRun] = useState<Run | null>(null)
  const resultRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let stopped = false
    api<DemoStatus>('/v1/demo').then(
      (s) => {
        if (stopped) return
        setLimits({ runsPerHour: s.runsPerHour, maxChars: s.maxChars })
        if (s.status !== 'ready') setNotice(noticeFor(s.status, 200, s.message ?? ''))
      },
      (e) => {
        if (!stopped && e instanceof ApiError) setNotice(noticeFor(e.code, e.status, e.message))
      },
    )
    return () => {
      stopped = true
    }
  }, [])

  useEffect(() => {
    if (run && window.matchMedia('(max-width: 1023px)').matches) resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [run])

  const preset = AVAILABLE.find((p) => p.key === presetKey) ?? null

  function load(p: Preset) {
    setPresetKey(p.key)
    setText(p.text)
    setSoftwareOn(!p.guardOff)
    setError(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const guardOff = !softwareOn
      const { runId } = await api<{ runId: string }>('/v1/demo/runs', { method: 'POST', json: { text, guardOff } })
      // the preset label only applies while the text is still the preset's
      setRun({ id: runId, title: preset && text === preset.text ? preset.title : undefined, guardOff })
      setNotice(null)
    } catch (err) {
      if (err instanceof ApiError && (err.code || err.status === 429 || err.status === 404 || err.status === 0 || err.status >= 500)) setNotice(noticeFor(err.code, err.status, err.message))
      else setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className={`${wrap} flex flex-1 flex-col gap-8 py-8 sm:gap-12 sm:py-12`}>
      <PageHead
        title="Try to make our AI agent pay a stranger."
        lede={
          <>
            Write the scam invoice yourself and send it to our AI agent. With Bound&apos;s software on, it checks who owns the wallet before any money moves. Switch it off and
            the agent pays whatever it&apos;s told. Tempo still refuses any wallet the company never approved.
          </>
        }
      >
        <p className="flex flex-wrap gap-x-5 gap-y-1 text-[14px] text-fg3">
          <span>No wallet needed</span>
          <span>{network === 'mainnet' ? 'Runs on Tempo' : 'Runs on Tempo testnet'}</span>
          {scenario === 'invoice' && <span>{limits.runsPerHour} runs an hour</span>}
        </p>
      </PageHead>

      <div className="flex flex-col gap-4 sm:gap-6">
        <Segmented label="Scenario" options={SCENARIOS} value={scenario} onChange={setScenario} />

        {scenario === 'api' ? (
          <ApiScenario />
        ) : (
          <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2 lg:gap-6">
            <form onSubmit={submit} className={`${card} flex min-w-0 flex-col gap-6`} noValidate>
              <div className="flex items-center justify-between gap-4">
                <Pill>Attack lab</Pill>
                <span className="text-[15px] text-fg3">Demo company</span>
              </div>
              <div className="flex flex-col gap-3">
                <h2 className={cardTitle}>Write the scam</h2>
                {AVAILABLE.length > 0 && (
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Presets">
                    {AVAILABLE.map((p) => (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => load(p)}
                        aria-pressed={presetKey === p.key}
                        className={`${smallBtn} aria-pressed:border-fg aria-pressed:bg-fg aria-pressed:text-ink`}
                      >
                        {p.title}
                      </button>
                    ))}
                  </div>
                )}
                {preset ? (
                  <p className="text-[14.5px] leading-relaxed text-fg2">{preset.about}</p>
                ) : (
                  <p className={hint}>{AVAILABLE.length ? 'Pick a preset, or write your own invoice.' : 'Write an invoice with a Tempo wallet address to pay.'}</p>
                )}
              </div>

              <div className="flex flex-1 flex-col">
                <div className="mb-2 flex items-baseline justify-between gap-4">
                  <label htmlFor="tryText" className="text-sm font-medium text-fg">
                    Invoice
                  </label>
                  <span className={`${hint} tabular-nums`} aria-hidden="true">
                    {text.length.toLocaleString('en-US')} / {limits.maxChars.toLocaleString('en-US')}
                  </span>
                </div>
                <textarea
                  id="tryText"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  maxLength={limits.maxChars}
                  rows={12}
                  placeholder="From: …&#10;Invoice …&#10;Pay to (Tempo): 0x…"
                  className={`${fieldClass} flex-1 resize-y text-[13px] leading-relaxed`}
                />
              </div>

              <Switch
                id="software"
                label="Bound software"
                text="Switch it off to skip Bound's checks. The agent then pays whatever it's told, and only Tempo's key rules remain."
                on={softwareOn}
                onChange={setSoftwareOn}
              />

              <div className="flex flex-col gap-3">
                <button type="submit" disabled={busy || !text.trim() || !!notice?.blocking} className={primaryBtn}>
                  {busy ? 'Starting…' : softwareOn ? 'Run the agent' : 'Run with Bound off'}
                </button>
                {notice && <DemoNotice notice={notice} />}
                {error && <p className={errorText}>{error}</p>}
              </div>
            </form>

            <div ref={resultRef} className="flex min-w-0 scroll-mt-6 flex-col">
              {run ? (
                <RunResult key={run.id} id={run.id} path={`/v1/demo/runs/${encodeURIComponent(run.id)}`} title={run.title} guardOff={run.guardOff} switchLabel="Bound software" />
              ) : (
                <ResultPlaceholder offPhrase="Bound’s software off" offShort="Bound off" />
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
