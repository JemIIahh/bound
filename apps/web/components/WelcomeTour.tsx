'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowIcon, BoundMark, CheckIcon, CrossIcon, Pill } from './atoms'
import { primaryBtn } from './ui'

const SEEN_KEY = 'bound.tour.v1'
const OPEN_EVENT = 'bound:tour'
const STEP_MS = 5200
const TICK_MS = 50

/** Opens the welcome tour from anywhere (the footer's "Take the tour"). */
export function openTour() {
  window.dispatchEvent(new Event(OPEN_EVENT))
}

function seen() {
  try {
    return localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return true // storage blocked (previews, thumbnails): never trap the page behind the tour
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1')
  } catch {
    // storage blocked: the tour shows again next visit
  }
}

type Step = { label: string; title: string; body: string; scene: ReactNode }

const STEPS: Step[] = [
  {
    label: 'The scam',
    title: 'A fake email asks your AI to pay a new wallet.',
    body: 'It looks like your supplier. The wallet belongs to a scammer.',
    scene: <ScamScene />,
  },
  {
    label: 'Suppliers',
    title: 'Real suppliers prove their wallet once.',
    body: 'Acme links its wallet to acme.com. Anyone paying Acme can check it.',
    scene: <SupplierScene />,
  },
  {
    label: 'Bound',
    title: 'Bound checks every payment before it moves.',
    body: 'Same first and last characters? The middle gives the lookalike away.',
    scene: <CheckScene />,
  },
  {
    label: 'Tempo',
    title: 'Even if everything else fails, Tempo says no.',
    body: "Your AI's key can only pay approved suppliers. We tested it with our own check switched off.",
    scene: <TempoScene />,
  },
]

const START_LINKS = [
  { href: '/app', label: 'I pay suppliers' },
  { href: '/payee', label: "I'm a supplier" },
  { href: '/verify', label: 'Check a wallet' },
]

/** First-visit welcome: a small animated walkthrough of Bound in four steps, shown once per browser. */
export function WelcomeTour() {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [paused, setPaused] = useState(false)
  const [reduced, setReduced] = useState(false)
  const [progress, setProgress] = useState(0) // 0..1 through the current step
  const primary = useRef<HTMLButtonElement>(null)
  const last = step === STEPS.length - 1

  useEffect(() => {
    setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    if (!seen() || new URLSearchParams(window.location.search).has('tour')) setOpen(true)
    const show = () => {
      setStep(0)
      setOpen(true)
    }
    window.addEventListener(OPEN_EVENT, show)
    return () => window.removeEventListener(OPEN_EVENT, show)
  }, [])

  const close = useCallback(() => {
    markSeen()
    setOpen(false)
  }, [])

  const go = useCallback((n: number) => setStep(Math.max(0, Math.min(STEPS.length - 1, n))), [])

  // auto-advance like a story; hovering the card holds the current step
  useEffect(() => setProgress(0), [step, open])
  useEffect(() => {
    if (!open || paused || reduced || last) return
    const t = setInterval(() => setProgress((p) => p + TICK_MS / STEP_MS), TICK_MS)
    return () => clearInterval(t)
  }, [open, paused, reduced, last])
  useEffect(() => {
    if (progress < 1) return
    setProgress(0) // reset in the same render as the step change, so this effect can't advance twice
    go(step + 1)
  }, [progress, step, go])

  // modal housekeeping: lock page scroll, restore focus on close
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const html = document.documentElement
    const overflow = html.style.overflow
    html.style.overflow = 'hidden'
    return () => {
      html.style.overflow = overflow
      prev?.focus?.({ preventScroll: true })
    }
  }, [open])

  useEffect(() => {
    if (open) primary.current?.focus({ preventScroll: true })
  }, [open, last])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowRight') go(step + 1)
      else if (e.key === 'ArrowLeft') go(step - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, step, close, go])

  if (!open) return null
  const s = STEPS[step]

  return (
    <div className="tour-fade fixed inset-0 z-50 grid place-items-center bg-black/65 px-4 backdrop-blur-sm" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        className="tour-rise relative flex w-full max-w-[460px] flex-col overflow-hidden rounded-card border border-line bg-card shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9),0_0_80px_-30px_rgba(255,90,60,0.35)]"
      >
        <div className="flex items-center gap-3 px-6 pt-5">
          <BoundMark size={22} />
          <div className="flex flex-1 gap-1.5" aria-hidden="true">
            {STEPS.map((_, i) => (
              <span key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-raised">
                <span
                  className="block h-full rounded-full bg-acc transition-[width] duration-75 ease-linear"
                  style={{ width: `${i < step ? 100 : i > step ? 0 : last || reduced ? 100 : Math.min(progress, 1) * 100}%` }}
                />
              </span>
            ))}
          </div>
          <button type="button" onClick={close} className="-mr-2 rounded-full p-2 text-fg3 transition hover:text-fg" aria-label="Skip the tour">
            <CrossIcon size={14} />
          </button>
        </div>

        <div key={step} className="relative mx-6 mt-4 grid h-[176px] shrink-0 place-items-center overflow-hidden rounded-2xl border border-line2 bg-field">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_80%_at_50%_0%,rgba(255,90,60,0.10),rgba(255,90,60,0)_70%)]" />
          {s.scene}
        </div>

        <div key={`t-${step}`} className="tour-in min-h-[186px] px-6 pt-5 sm:min-h-[150px]" aria-live="polite">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-acc2">
            {step + 1} of {STEPS.length} · {s.label}
          </p>
          <h2 id="tour-title" className="mt-2 font-display text-[23px] font-extrabold leading-[1.08] tracking-[-0.03em] text-fg">
            {s.title}
          </h2>
          <p id="tour-body" className="mt-2 text-[14px] leading-relaxed text-fg2">
            {s.body}
          </p>
        </div>

        <div className="flex min-h-[136px] flex-col justify-end px-6 pb-5 pt-3 sm:min-h-[112px]">
          {last ? (
            <>
              <button ref={primary} type="button" onClick={close} className={primaryBtn}>
                Got it
              </button>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[13px] text-fg3">
                <span>or start with:</span>
                {START_LINKS.map((l) => (
                  <Link key={l.href} href={l.href} onClick={close} className="text-fg2 underline decoration-fg3/50 underline-offset-4 transition hover:text-fg">
                    {l.label}
                  </Link>
                ))}
              </div>
            </>
          ) : (
            <div className="flex items-center gap-3">
              <button type="button" onClick={close} className="px-1 text-sm text-fg3 transition hover:text-fg">
                Skip
              </button>
              <div className="ml-auto flex gap-2">
                {step > 0 && (
                  <button type="button" onClick={() => go(step - 1)} className="h-11 rounded-btn border border-edge px-4 text-sm font-semibold text-fg transition hover:bg-fg/5">
                    Back
                  </button>
                )}
                <button ref={primary} type="button" onClick={() => go(step + 1)} className="inline-flex h-11 items-center gap-2 rounded-btn bg-btn px-5 text-sm font-bold text-btn-fg transition hover:brightness-110">
                  Next <ArrowIcon size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Addr({ head, mid, tail, tone }: { head: string; mid: string; tail: string; tone: 'ok' | 'bad' }) {
  return (
    <span className="font-mono text-[13px] tracking-[0.02em] text-fg">
      {head}
      <span className={tone === 'bad' ? 'tour-mark rounded px-0.5 text-acc' : 'text-ok'}>{mid}</span>
      {tail}
    </span>
  )
}

function ScamScene() {
  return (
    <div className="tour-in relative w-[84%] rounded-xl border border-line bg-card p-4 shadow-card">
      <div className="flex items-center justify-between gap-3 text-[12px] text-fg3">
        <span className="truncate">
          From <span className="tour-mark rounded px-0.5 text-acc2">billing@acme-ltd.co</span>
        </span>
        <span className="font-mono">09:41</span>
      </div>
      <p className="mt-3 text-[14px] leading-snug text-fg">&ldquo;We changed our wallet. Please pay invoice #2291 to:&rdquo;</p>
      <p className="tour-late mt-2 rounded-lg bg-raised px-3 py-2">
        <Addr head="0xC1A5" mid="d69D" tail="…C426" tone="bad" />
      </p>
    </div>
  )
}

function SupplierScene() {
  return (
    <div className="tour-in flex w-[84%] items-center gap-3 rounded-xl border border-line bg-card p-4 shadow-card">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#a86a2c] font-bold text-white">A</span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold text-fg">Acme Ltd</p>
        <p className="mt-0.5 truncate">
          <Addr head="0xC1A5" mid="3DA9" tail="…C426" tone="ok" />
        </p>
      </div>
      <span className="tour-pop">
        <Pill tone="green" icon={<CheckIcon />}>
          acme.com
        </Pill>
      </span>
    </div>
  )
}

function CheckScene() {
  return (
    <div className="w-[84%] space-y-2">
      <div className="tour-in flex items-center justify-between gap-3 rounded-xl border border-line bg-card px-4 py-3">
        <span className="text-[12px] text-fg3">Verified</span>
        <Addr head="0xC1A5" mid="3DA9" tail="…C426" tone="ok" />
      </div>
      <div className="tour-in tour-d1 flex items-center justify-between gap-3 rounded-xl border border-acc/40 bg-card px-4 py-3">
        <span className="text-[12px] text-fg3">Invoice</span>
        <Addr head="0xC1A5" mid="d69D" tail="…C426" tone="bad" />
      </div>
      <div className="tour-pop tour-d2 flex justify-center pt-1">
        <Pill tone="red" dot="bg-current">
          Lookalike · blocked
        </Pill>
      </div>
    </div>
  )
}

function TempoScene() {
  return (
    <div className="flex flex-col items-center gap-6">
      <div className="tour-stamp -rotate-6 rounded-xl border-[3px] border-acc bg-[rgba(16,14,13,0.85)] p-1 text-acc shadow-[0_0_50px_-10px_rgba(255,90,60,0.45)]">
        <div className="rounded-lg border-2 border-acc px-4 py-1.5 text-center">
          <b className="block font-display text-[26px] font-black uppercase leading-[0.95]">
            Blocked
            <br />
            by Tempo
          </b>
        </div>
      </div>
      <p className="tour-in tour-d2 font-mono text-[12px] text-fg2">$0 moved · tx reverted</p>
    </div>
  )
}
