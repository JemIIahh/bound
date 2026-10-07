'use client'

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ApiError, api, errorMessage, type ApiRunResult, type ApiRunStatus, type ApiRunStep } from '@/lib/api'
import { txUrl } from '@/lib/chain'
import { Addr, ArrowIcon, CheckIcon, CrossIcon, Pill, ShieldIcon } from './atoms'
import { BlockedStamp } from './BlockedStamp'
import { DemoNotice, Switch, noticeFor, type Notice } from './DemoControls'
import { explorerLink } from './LabRun'
import { card, cardTitle, errorText, isTxHash, primaryBtn, short } from './ui'

// The paid-API scenario on /try: an agent step buys a price index from Bound's demo paid API, which answers
// HTTP 402 with a payment request (MPP). The server runs the whole purchase (POST /v1/demo/api-runs) and answers
// with every step and the outcome; this only shows them.

type Settings = { hijacked: boolean; guardOff: boolean }

const phone = () => window.matchMedia('(max-width: 1023px)').matches

export function ApiScenario() {
  const [hijacked, setHijacked] = useState(false)
  const [softwareOn, setSoftwareOn] = useState(true)
  const [running, setRunning] = useState<Settings | null>(null)
  const [done, setDone] = useState<(Settings & { result: ApiRunResult }) | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [runsPerHour, setRunsPerHour] = useState<number | null>(null)
  const resultRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const scrolled = useRef(false)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    let stopped = false
    api<ApiRunStatus>('/v1/demo/api-runs/status').then(
      (s) => {
        if (stopped) return
        setRunsPerHour(s.runsPerHour)
        if (s.status !== 'ready') setNotice(noticeFor(s.status, 200, s.message ?? ''))
      },
      (e) => {
        if (!stopped && e instanceof ApiError) setNotice(noticeFor(e.code, e.status, e.message))
      },
    )
    return () => {
      stopped = true
      alive.current = false
    }
  }, [])

  // Phones: bring the result into view once a run is under way. An instant refusal (rate limit, offline) is
  // shown by the button, so wait a moment first.
  useEffect(() => {
    if (!running || !phone()) return
    const timer = setTimeout(() => {
      scrolled.current = true
      resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 300)
    return () => clearTimeout(timer)
  }, [running])

  useEffect(() => {
    if (done && !scrolled.current && phone()) resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [done])

  async function submit(e: FormEvent) {
    e.preventDefault()
    const settings = { hijacked, guardOff: !softwareOn }
    scrolled.current = false
    setRunning(settings)
    setDone(null)
    setError(null)
    try {
      const result = await api<ApiRunResult>('/v1/demo/api-runs', { method: 'POST', json: settings })
      if (!alive.current) return
      setDone({ ...settings, result })
      setNotice(null)
    } catch (err) {
      if (!alive.current) return
      if (err instanceof ApiError && (err.code || err.status === 429 || err.status === 404 || err.status === 0 || err.status >= 500)) setNotice(noticeFor(err.code, err.status, err.message))
      else setError(errorMessage(err))
      // the page already moved to the result: go back to the message by the button
      if (scrolled.current) buttonRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } finally {
      if (alive.current) setRunning(null)
    }
  }

  const shown = running ?? done

  return (
    <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2 lg:gap-6">
      <form onSubmit={submit} className={`${card} flex min-w-0 flex-col gap-6`} noValidate>
        <div className="flex items-center justify-between gap-4">
          <Pill>Paid API</Pill>
          <span className="text-[15px] text-fg3">{runsPerHour !== null ? `${runsPerHour} runs an hour` : 'Demo agent'}</span>
        </div>
        <div className="flex flex-col gap-3">
          <h2 className={cardTitle}>Buy a price index</h2>
          <p className="text-[14.5px] leading-relaxed text-fg2">
            An agent buys a price index from a paid API. Switch on the hijack and the API names a scammer&apos;s wallet.
          </p>
        </div>

        <div className="flex flex-col gap-6">
          <Switch
            id="api-hijacked"
            label="API is hijacked"
            text="The API asks to be paid into a lookalike wallet instead of Acme Ltd's."
            on={hijacked}
            onChange={setHijacked}
            danger
          />
          <Switch
            id="api-software"
            label="Bound software"
            text="Switch it off to skip Bound's check. The agent then signs whatever the API asks for, and only Tempo's key rules remain."
            on={softwareOn}
            onChange={setSoftwareOn}
          />
        </div>

        <div className="flex flex-col gap-3">
          <button ref={buttonRef} type="submit" disabled={!!running || !!notice?.blocking} className={primaryBtn}>
            {running ? 'Buying the data…' : 'Buy the data'}
          </button>
          {notice && <DemoNotice notice={notice} />}
          {error && <p className={errorText}>{error}</p>}
        </div>
      </form>

      <div ref={resultRef} className="flex min-w-0 scroll-mt-6 flex-col">
        {shown ? <ApiRunCard settings={shown} result={running ? null : (done?.result ?? null)} /> : <ApiRunPlaceholder />}
      </div>
    </div>
  )
}

/** One paid-API run: a calm progress state while the server works, then every step and the outcome. */
function ApiRunCard({ settings, result }: { settings: Settings; result: ApiRunResult | null }) {
  return (
    <section className={`${card} flex flex-1 flex-col overflow-hidden !p-0`} aria-live="polite" aria-busy={!result} aria-labelledby="api-result-label">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line2 px-6 py-5 sm:px-10">
        <div className="flex min-w-0 items-center gap-3 text-[15px] font-semibold">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#1F2227]" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="#A4A8B1" strokeWidth="1.6">
              <rect x="3" y="5" width="12" height="9" rx="3" />
              <path d="M9 2v3" strokeLinecap="round" />
              <circle cx="6.8" cy="9.5" r="1" fill="#A4A8B1" stroke="none" />
              <circle cx="11.2" cy="9.5" r="1" fill="#A4A8B1" stroke="none" />
            </svg>
          </span>
          <span id="api-result-label">Result</span>
          <span className="min-w-0 font-normal text-fg2">{settings.hijacked ? 'Hijacked API' : 'Honest API'}</span>
        </div>
        {!result && <Pill live>Live</Pill>}
        <span className="flex items-center gap-2 whitespace-nowrap text-sm text-fg2 sm:ml-auto">
          Bound software
          <span className={`relative h-5 w-8 rounded-full ${settings.guardOff ? 'bg-[#2A2E36]' : 'bg-ok'}`} aria-hidden="true">
            <span className={`absolute top-[3px] h-3.5 w-3.5 rounded-full ${settings.guardOff ? 'left-[3px] bg-fg3' : 'right-[3px] bg-bg'}`} />
          </span>
          <b className="font-semibold text-fg">{settings.guardOff ? 'Off' : 'On'}</b>
        </span>
      </div>

      {result ? (
        <>
          <div className="px-6 py-8 sm:px-10">
            <h3 className="text-lg font-semibold tracking-[-0.015em]">What happened</h3>
            <Steps steps={result.steps} outcome={result.outcome} />
          </div>
          <div className="mt-auto border-t border-line2 px-6 py-8 sm:px-10">
            <OutcomeView r={result} />
          </div>
        </>
      ) : (
        <div className="px-6 py-8 sm:px-10">
          <p className="flex items-center gap-3 text-xl font-semibold tracking-[-0.015em] text-fg">
            <span className="live-dot inline-block h-2 w-2 rounded-full bg-acc" />
            The agent is buying the data…
          </p>
          <p className={`mt-3 ${body}`}>
            {settings.guardOff
              ? 'It asks the API for the data and signs whatever payment request comes back. A real run on Tempo testnet takes a few seconds.'
              : 'It asks the API for the data, and Bound checks the wallet in the payment request before anything is signed. A real run on Tempo testnet takes a few seconds.'}
          </p>
        </div>
      )}
    </section>
  )
}

/** The result card before anything ran: what each outcome means. */
function ApiRunPlaceholder() {
  return (
    <div className={`${card} flex flex-1 flex-col`}>
      <div className="flex items-center justify-between gap-4">
        <Pill>Result</Pill>
        <span className="text-[15px] text-fg3">Nothing run yet</span>
      </div>
      <p className={`mt-6 ${cardTitle} !text-fg3`}>Buy the data and watch every step.</p>
      <p className={`mt-2 ${body}`}>Each run shows what the API asked for, what Bound decided, and — with Bound off — what Tempo did with the payment.</p>
      <ul className="mt-8 flex flex-col border-t border-line2 text-[15px] text-fg2">
        {[
          ['bg-acc', 'Blocked by Bound', 'the API named a wallet that isn’t Acme’s'],
          ['bg-acc', 'Blocked by Tempo', 'Bound off, and the wallet was never approved'],
          ['bg-ok', 'Paid', 'the API named Acme’s verified wallet'],
        ].map(([dot, title, text]) => (
          <li key={title} className="flex items-baseline gap-3 border-b border-line2 py-3">
            <span className={`h-2 w-2 shrink-0 translate-y-[-1px] rounded-full ${dot}`} />
            <span>
              <b className="font-semibold text-fg">{title}</b> — {text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

const headline = 'text-2xl font-semibold leading-[1.2] tracking-[-0.025em] text-fg'
const body = 'text-[15px] leading-relaxed text-fg2'
const ADDRESS = /^0x[0-9a-fA-F]{40}$/

type Tone = 'plain' | 'ok' | 'bad'
const CHIP: Record<Tone, string> = { plain: 'bg-raised text-fg2', ok: 'bg-ok/12 text-ok', bad: 'bg-acc/15 text-acc2' }

/** The decision and the final step carry the outcome's colour; every other step is neutral. */
function toneOf(kind: ApiRunStep['kind'], outcome: ApiRunResult['outcome']): Tone {
  if (kind === 'decision') return outcome === 'paid' ? 'ok' : outcome === 'blocked_by_bound' ? 'bad' : 'plain'
  if (kind === 'result') return outcome === 'paid' ? 'ok' : outcome === 'failed' ? 'plain' : 'bad'
  return 'plain'
}

function StepIcon({ kind, tone }: { kind: ApiRunStep['kind']; tone: Tone }) {
  if (tone === 'ok') return <CheckIcon size={12} />
  if (tone === 'bad') return <CrossIcon size={12} />
  switch (kind) {
    case 'request':
      return <ArrowIcon size={14} />
    case 'challenge':
      return (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M4 1.75h5.5L12.25 4.5v9.75H4z" strokeLinejoin="round" />
          <path d="M6.25 7.5h3.5M6.25 10h3.5" strokeLinecap="round" />
        </svg>
      )
    case 'sign':
      return (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M10.5 2.5l3 3L6 13H3v-3z" strokeLinejoin="round" />
        </svg>
      )
    case 'check':
    case 'decision':
      return <ShieldIcon size={12} />
    default:
      return <span className="h-1.5 w-1.5 rounded-full bg-current" />
  }
}

/** Wallet addresses in a step's data, labelled by their field (`recipient`, `wallet`…), each once. */
function addressesIn(data: unknown): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = []
  const walk = (v: unknown, label: string, depth: number) => {
    if (typeof v === 'string') {
      if (ADDRESS.test(v) && !out.some((a) => a.value.toLowerCase() === v.toLowerCase())) out.push({ label, value: v })
    } else if (v && typeof v === 'object' && depth < 3) {
      for (const [k, x] of Object.entries(v)) walk(x, Array.isArray(v) ? label : k, depth + 1)
    }
  }
  walk(data, '', 0)
  return out
}

/** The step's sentence, with any address or hash in it set in mono and shortened (full value on hover). */
function richText(text: string): ReactNode[] {
  return text.split(/(0x[0-9a-fA-F]{64}|0x[0-9a-fA-F]{40})/).map((part, i) =>
    i % 2 ? (
      <span key={i} title={part} className="whitespace-nowrap font-mono text-[13px] text-fg">
        {short(part)}
      </span>
    ) : (
      part
    ),
  )
}

function Steps({ steps, outcome }: { steps: ApiRunStep[]; outcome: ApiRunResult['outcome'] }) {
  if (!steps.length) return <p className="mt-3 text-[15px] text-fg3">The run logged no steps.</p>
  return (
    <ol className="mt-5 flex flex-col">
      {steps.map((s, i) => {
        const tone = toneOf(s.kind, outcome)
        const addrs = addressesIn(s.data)
        return (
          <li key={i} className="relative flex gap-4 pb-5 last:pb-0">
            {i < steps.length - 1 && <span className="absolute bottom-0 left-[15.5px] top-9 w-px bg-line" aria-hidden="true" />}
            <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${CHIP[tone]}`} aria-hidden="true">
              <StepIcon kind={s.kind} tone={tone} />
            </span>
            <div className="min-w-0 flex-1 pt-[5px]">
              <p className={`text-[15px] leading-snug ${tone === 'bad' ? 'text-acc2' : 'text-fg'}`}>{richText(s.text)}</p>
              {addrs.map((a) => (
                <AddrLine key={a.value} label={a.label} value={a.value} className="mt-1.5" />
              ))}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/** A labelled full address in mono; a wrapped second half lines up under the first. */
function AddrLine({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  if (!ADDRESS.test(value)) return null
  return (
    <p className={`flex gap-2 font-mono text-[12.5px] leading-snug text-fg3 ${className}`}>
      {label && <span className="shrink-0">{label}</span>}
      <span className="min-w-0 text-fg2">
        <Addr value={value} />
      </span>
    </p>
  )
}

function OutcomeView({ r }: { r: ApiRunResult }) {
  // the server's explorer link, or one built from the hash; explorerLink only links a real https …/tx/0x… URL
  const link = r.txUrl ?? (isTxHash(r.txHash) ? txUrl(r.txHash) : null)
  switch (r.outcome) {
    case 'paid':
      return (
        <div className="flex flex-col gap-3">
          <div>
            <Pill tone="green">Paid</Pill>
          </div>
          <p className={`mt-2 ${headline}`}>0.01 pathUSD to Acme Ltd (verified)</p>
          {r.message && <p className={body}>{richText(r.message)}</p>}
          <AddrLine label="paid to" value={r.recipient} />
          {explorerLink(link, 'View the payment')}
        </div>
      )
    case 'blocked_by_bound':
      return (
        <div className="flex flex-col gap-4">
          <BlockedStamp
            by="Bound"
            note={
              <>
                Bound read the payment request
                <br />
                and stopped before signing.
              </>
            }
            className="my-4 self-center"
          />
          <p className={headline}>$0 moved</p>
          {r.message && <p className={body}>{richText(r.message)}</p>}
          <AddrLine label="asked to pay" value={r.recipient} />
        </div>
      )
    case 'blocked_by_tempo':
      return (
        <div className="flex flex-col gap-4">
          <BlockedStamp className="my-4 self-center" />
          {r.message && <p className={body}>{richText(r.message)}</p>}
          <AddrLine label="asked to pay" value={r.recipient} />
          {explorerLink(link, 'View the reverted transaction')}
        </div>
      )
    default:
      return (
        <div className="flex flex-col gap-3">
          <div>
            <Pill>Didn’t finish</Pill>
          </div>
          <p className={`mt-2 ${headline} !text-fg2`}>The demo hit a problem. Try again.</p>
          {r.message && <p className={`${body} [overflow-wrap:anywhere]`}>{r.message}</p>}
        </div>
      )
  }
}
