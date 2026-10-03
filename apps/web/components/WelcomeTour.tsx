'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowIcon, BoundMark, CheckIcon, CrossIcon } from './atoms'
import { primaryBtn } from './ui'

const SEEN_KEY = 'bound.tour.v2'
const OPEN_EVENT = 'bound:tour'

/** Opens the welcome guide from anywhere (the footer's "Take the tour"). */
export function openTour() {
  window.dispatchEvent(new Event(OPEN_EVENT))
}

function seen() {
  try {
    return localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return true // storage blocked (previews, thumbnails): never trap the page behind the guide
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1')
  } catch {
    // storage blocked: the guide shows again next visit
  }
}

type Role = 'pay' | 'get' | 'check'
type Step = { title: string; body: string; scene: ReactNode }
type Path = { label: string; steps: Step[]; cta: { href: string; label: string } }

// Each path follows the real flow it ends in: /app (OrgSetup, approvals), /payee (PayeeOnboarding), /verify.
const PATHS: Record<Role, Path> = {
  pay: {
    label: 'Paying suppliers',
    cta: { href: '/app', label: 'Set up my dashboard' },
    steps: [
      {
        title: 'Connect your company wallet.',
        body: "It's the wallet that owns your agent's payment key. You sign the key and every supplier approval with it. Bound never holds it.",
        scene: <WalletScene label="Your company wallet" badge="Connected" />,
      },
      {
        title: 'Give your agent a payment key.',
        body: 'One transaction authorizes it, with a weekly spending limit that Tempo enforces. Until you approve a supplier, it can only send money back to you.',
        scene: <KeyScene />,
      },
      {
        title: 'Approve suppliers as they come.',
        body: "A new supplier waits for your Approve, one wallet signature. After that their invoices pay themselves. Lookalikes are blocked outright.",
        scene: <ApproveScene />,
      },
    ],
  },
  get: {
    label: 'Getting paid',
    cta: { href: '/payee', label: 'Get my company verified' },
    steps: [
      {
        title: "Connect the wallet you're paid to.",
        body: 'Use the wallet your company receives payments to. Bound never asks for funds or keys.',
        scene: <WalletScene label="Your receiving wallet" badge="Connected" />,
      },
      {
        title: 'Prove the wallet and domain are yours.',
        body: 'Sign with your wallet, then add one TXT record at your DNS provider. Keep it in place until you publish.',
        scene: <ProofScene />,
      },
      {
        title: 'Publish once. Every payer sees you.',
        body: 'Add an LEI if you have one: it raises you to level 2. Your progress is saved in this browser, so you can come back.',
        scene: <SupplierScene />,
      },
    ],
  },
  check: {
    label: 'Checking a wallet',
    cta: { href: '/verify', label: 'Check a wallet' },
    steps: [
      {
        title: "Paste what's on the invoice.",
        body: 'The wallet address and the company name. No wallet or account needed.',
        scene: <InvoiceScene />,
      },
      {
        title: 'Get a verdict before you pay.',
        body: 'Bound checks the verified registry on Tempo and flags lookalike addresses, changed wallets and impersonation.',
        scene: <CheckScene />,
      },
    ],
  },
}

// The whole idea in three screens, shown before the visitor picks a path.
const STORY: Path = {
  label: 'The big picture',
  cta: { href: '/', label: '' },
  steps: [
    {
      title: 'Scammers send your AI agent fake invoices.',
      body: "A fake email says \"we changed our wallet\". Stablecoin payments can't be undone, and an agent can pay in a second.",
      scene: <ScamScene />,
    },
    {
      title: 'Bound checks who owns the wallet.',
      body: 'Suppliers prove their wallet once. Before any money moves, Bound compares each invoice with that public list and stops lookalikes.',
      scene: <CheckScene />,
    },
    {
      title: 'You stay in control.',
      body: 'Your agent can only pay suppliers you approved. A new one waits for your Approve, and Tempo refuses everyone else, even if Bound is off.',
      scene: <ListScene />,
    },
  ],
}

const ROLES: { role: Role; title: string; text: string }[] = [
  { role: 'pay', title: 'I pay suppliers', text: 'My company has an AI agent that pays invoices' },
  { role: 'get', title: 'I get paid', text: "I'm a supplier and want payers to trust my wallet" },
  { role: 'check', title: 'I just want to check a wallet', text: 'Before I send money to someone' },
]

/** First-visit guide: pick what you are here to do, then a few short screens that end on the right page. Shown once per browser. */
export function WelcomeTour() {
  const [open, setOpen] = useState(false)
  const [stage, setStage] = useState<'story' | 'choose' | 'path'>('story')
  const [role, setRole] = useState<Role | null>(null)
  const [step, setStep] = useState(0)
  const primary = useRef<HTMLButtonElement & HTMLAnchorElement>(null)
  const firstRole = useRef<HTMLButtonElement>(null)

  const path = stage === 'story' ? STORY : stage === 'path' && role ? PATHS[role] : null
  const last = path ? step === path.steps.length - 1 : false
  const isStory = stage === 'story'

  useEffect(() => {
    if (!seen() || new URLSearchParams(window.location.search).has('tour')) setOpen(true)
    const show = () => {
      setStage('story')
      setRole(null)
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

  const choose = useCallback((r: Role) => {
    setRole(r)
    setStage('path')
    setStep(0)
  }, [])

  const next = useCallback(() => {
    if (!path) return
    if (isStory && last) setStage('choose')
    else setStep((s) => Math.min(path.steps.length - 1, s + 1))
  }, [path, isStory, last])
  const back = useCallback(() => {
    if (stage === 'choose') {
      setStage('story')
      setStep(STORY.steps.length - 1)
    } else if (stage === 'path' && step === 0) {
      setStage('choose')
      setRole(null)
    } else if (step > 0) setStep(step - 1)
  }, [stage, step])

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
    if (!open) return
    ;(stage === 'choose' ? firstRole : primary).current?.focus({ preventScroll: true })
  }, [open, stage, step])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      else if (stage !== 'choose' && e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') back()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, stage, close, next, back])

  if (!open) return null
  const s = path ? path.steps[step] : null

  return (
    <div className="tour-fade fixed inset-0 z-50 flex overflow-y-auto bg-black/65 px-4 py-6 backdrop-blur-sm" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        onClick={(e) => e.stopPropagation()}
        className="tour-rise relative m-auto flex w-full max-w-[520px] flex-col overflow-hidden rounded-card border border-line bg-card shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9),0_0_80px_-30px_rgba(255,90,60,0.35)]"
      >
        <div className="flex items-center gap-3 px-5 pt-5 sm:px-8 sm:pt-7">
          <BoundMark size={24} />
          <div className="flex flex-1 gap-1.5" aria-hidden="true">
            {(path ? path.steps : STORY.steps).map((_, i) => (
              <span key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-raised">
                <span className="block h-full rounded-full bg-acc transition-[width] duration-200" style={{ width: stage === 'choose' || (path && i <= step) ? '100%' : '0%' }} />
              </span>
            ))}
          </div>
          <button type="button" onClick={close} className="-mr-2 rounded-full p-2 text-fg3 transition hover:text-fg" aria-label="Close the guide">
            <CrossIcon size={16} />
          </button>
        </div>

        {!path || !s ? (
          <div key="choose" className="tour-in flex min-h-[420px] flex-col px-5 pb-5 pt-6 sm:min-h-[470px] sm:px-8 sm:pb-7 sm:pt-8">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-acc2 sm:text-[12px]">Now, your turn</p>
            <h2 id="tour-title" className="mt-2 text-balance font-display text-[26px] font-extrabold leading-[1.06] tracking-[-0.03em] text-fg sm:text-[32px]">
              What brings you here?
            </h2>
            <p className="mt-2 text-pretty text-[15px] leading-relaxed text-fg2 sm:text-[16px]">Pick one and we&apos;ll show you exactly what to do.</p>
            <div className="mt-5 flex flex-col gap-2.5">
              {ROLES.map((r, i) => (
                <button
                  key={r.role}
                  ref={i === 0 ? firstRole : undefined}
                  type="button"
                  onClick={() => choose(r.role)}
                  className="group flex items-center justify-between gap-4 rounded-2xl border border-line bg-field px-4 py-3.5 text-left transition hover:border-acc/60 hover:bg-raised sm:px-5 sm:py-4"
                >
                  <span className="min-w-0">
                    <span className="block text-[16px] font-semibold text-fg sm:text-[17px]">{r.title}</span>
                    <span className="mt-0.5 block text-[13.5px] leading-snug text-fg3 sm:text-[14.5px]">{r.text}</span>
                  </span>
                  <ArrowIcon size={15} />
                </button>
              ))}
            </div>
            <div className="mt-auto flex flex-col gap-3 pt-5 text-[14px] text-fg3 sm:text-[15px]">
              <Link href="/try" onClick={close} className="self-start text-fg2 underline decoration-fg3/50 underline-offset-4 transition hover:text-fg">
                Just want to see it work? Try the attack
              </Link>
              <div className="flex items-center justify-between">
                <button type="button" onClick={back} className="px-1 transition hover:text-fg">
                  Back
                </button>
                <button type="button" onClick={close} className="px-1 transition hover:text-fg">
                  Skip
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div key={`${role}-${step}`} className="relative mx-5 mt-5 grid h-[168px] shrink-0 place-items-center overflow-hidden rounded-2xl border border-line2 bg-field sm:mx-8 sm:mt-6 sm:h-[196px]">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_80%_at_50%_0%,rgba(255,90,60,0.10),rgba(255,90,60,0)_70%)]" />
              {s.scene}
            </div>

            <div key={`t-${role}-${step}`} className="tour-in min-h-[188px] px-5 pt-5 sm:min-h-[196px] sm:px-8 sm:pt-6" aria-live="polite">
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-acc2 sm:text-[12px]">
                {path.label} · {step + 1} of {path.steps.length}
              </p>
              <h2 id="tour-title" className="mt-2 text-balance font-display text-[22px] font-extrabold leading-[1.08] tracking-[-0.03em] text-fg sm:text-[27px]">
                {s.title}
              </h2>
              <p className="mt-2 text-pretty text-[15px] leading-relaxed text-fg2 sm:text-[16px]">{s.body}</p>
            </div>

            <div className="flex items-center gap-3 px-5 pb-5 pt-3 sm:px-8 sm:pb-7">
              {isStory && step === 0 ? (
                <button type="button" onClick={close} className="px-1 text-sm text-fg3 transition hover:text-fg sm:text-[15px]">
                  Skip
                </button>
              ) : (
                <button type="button" onClick={back} className="px-1 text-sm text-fg3 transition hover:text-fg sm:text-[15px]">
                  Back
                </button>
              )}
              <div className="ml-auto flex items-center gap-3">
                {last && !isStory ? (
                  <>
                    <button type="button" onClick={close} className="hidden whitespace-nowrap px-1 text-sm text-fg3 transition hover:text-fg sm:block sm:text-[15px]">
                      Got it
                    </button>
                    <Link ref={primary} href={path.cta.href} onClick={close} className={`${primaryBtn} whitespace-nowrap`}>
                      {path.cta.label} <ArrowIcon size={14} />
                    </Link>
                  </>
                ) : (
                  <button ref={primary} type="button" onClick={next} className="inline-flex h-11 items-center gap-2 rounded-btn bg-btn px-5 text-sm font-bold text-btn-fg transition hover:brightness-110 sm:h-12 sm:px-7 sm:text-[15px]">
                    Next <ArrowIcon size={14} />
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** A tag like the site's pills, sized for the guide's stage. */
function Badge({ tone, children }: { tone: 'ok' | 'bad'; children: ReactNode }) {
  const cls = tone === 'ok' ? 'border-ok/40 bg-ok/10 text-ok' : 'border-acc/50 bg-acc/12 text-acc2'
  return (
    <span className={`inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 font-mono text-[11px] font-medium uppercase tracking-[0.08em] sm:h-8 sm:text-[12px] ${cls}`}>
      {children}
    </span>
  )
}

function Addr({ head, mid, tail, tone }: { head: string; mid: string; tail: string; tone: 'ok' | 'bad' }) {
  return (
    <span className="font-mono text-[13px] tracking-[0.02em] text-fg sm:text-[15px]">
      {head}
      <span className={tone === 'bad' ? 'tour-mark rounded px-0.5 text-acc' : 'text-ok'}>{mid}</span>
      {tail}
    </span>
  )
}

const sceneCard = 'tour-in w-[88%] max-w-[420px] rounded-xl border border-line bg-card p-3.5 shadow-card sm:rounded-2xl sm:p-4'

function WalletScene({ label, badge }: { label: string; badge: string }) {
  return (
    <div className={`${sceneCard} flex items-center gap-3`}>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-raised font-mono text-[12px] text-fg2">0x</span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-fg sm:text-[15px]">{label}</p>
        <p className="mt-0.5 truncate font-mono text-[12px] text-fg3 sm:text-[13.5px]">0x7a3F…91bC</p>
      </div>
      <span className="tour-pop">
        <Badge tone="ok">
          <CheckIcon size={11} /> {badge}
        </Badge>
      </span>
    </div>
  )
}

function SceneRow({ label, children, delay }: { label: string; children: ReactNode; delay?: string }) {
  return (
    <div className={`tour-in ${delay ?? ''} flex items-center justify-between gap-3 border-b border-line2 py-2 last:border-b-0 sm:py-2.5`}>
      <span className="text-[12.5px] text-fg3 sm:text-[14px]">{label}</span>
      <span className="text-right text-[13px] font-medium text-fg sm:text-[14.5px]">{children}</span>
    </div>
  )
}

function KeyScene() {
  return (
    <div className="w-[88%] max-w-[420px] rounded-xl border border-line bg-card px-4 py-1.5 shadow-card sm:rounded-2xl sm:px-5">
      <SceneRow label="Payment key">
        <span className="font-mono">0x91e2…04aD</span>
      </SceneRow>
      <SceneRow label="Spending limit" delay="tour-d1">
        500 USD per week
      </SceneRow>
      <SceneRow label="Can pay" delay="tour-d2">
        Only your account, for now
      </SceneRow>
    </div>
  )
}

function ApproveScene() {
  return (
    <div className="flex w-[88%] max-w-[420px] flex-col gap-2.5">
      <div className={`${sceneCard} !w-full flex items-center gap-3`}>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#a86a2c] font-bold text-white">A</span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-fg sm:text-[15px]">Acme Ltd</p>
          <p className="mt-0.5 truncate">
            <Addr head="0xC1A5" mid="3DA9" tail="…C426" tone="ok" />
          </p>
        </div>
        <span className="tour-pop tour-d1 inline-flex h-8 shrink-0 items-center rounded-btn bg-btn px-3.5 text-[12.5px] font-bold text-btn-fg sm:h-9 sm:text-[14px]">Approve</span>
      </div>
      <p className="tour-in tour-d2 text-center font-mono text-[11.5px] text-fg2 sm:text-[13px]">New supplier · once approved, their next invoice pays itself</p>
    </div>
  )
}

function ProofScene() {
  return (
    <div className="flex w-[88%] max-w-[420px] flex-col gap-2.5">
      <div className="tour-in flex items-center justify-between gap-3 rounded-xl border border-line bg-card px-4 py-3 shadow-card sm:rounded-2xl">
        <span className="text-[13px] text-fg2 sm:text-[14.5px]">Wallet signed</span>
        <Badge tone="ok">
          <CheckIcon size={11} /> Done
        </Badge>
      </div>
      <div className="tour-in tour-d1 flex items-center justify-between gap-3 rounded-xl border border-line bg-card px-4 py-3 shadow-card sm:rounded-2xl">
        <span className="text-[13px] text-fg2 sm:text-[14.5px]">
          acme.com <span className="font-mono text-fg3">TXT</span>
        </span>
        <span className="tour-pop tour-d2">
          <Badge tone="ok">
            <CheckIcon size={11} /> Record found
          </Badge>
        </span>
      </div>
    </div>
  )
}

function SupplierScene() {
  return (
    <div className={`${sceneCard} flex items-center gap-3`}>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#a86a2c] font-bold text-white">A</span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-fg sm:text-[15px]">Acme Ltd</p>
        <p className="mt-0.5 truncate">
          <Addr head="0xC1A5" mid="3DA9" tail="…C426" tone="ok" />
        </p>
      </div>
      <span className="tour-pop">
        <Badge tone="ok">
          <CheckIcon size={11} /> acme.com
        </Badge>
      </span>
    </div>
  )
}

function InvoiceScene() {
  return (
    <div className="w-[88%] max-w-[420px] rounded-xl border border-line bg-card px-4 py-1.5 shadow-card sm:rounded-2xl sm:px-5">
      <SceneRow label="Wallet address">
        <Addr head="0xC1A5" mid="d69D" tail="…C426" tone="bad" />
      </SceneRow>
      <SceneRow label="Company name" delay="tour-d1">
        Acme Ltd
      </SceneRow>
    </div>
  )
}

function CheckScene() {
  return (
    <div className="w-[88%] max-w-[420px] space-y-2">
      <div className="tour-in flex items-center justify-between gap-3 rounded-xl border border-line bg-card px-4 py-2.5 sm:rounded-2xl">
        <span className="text-[12px] text-fg3 sm:text-[14px]">Verified</span>
        <Addr head="0xC1A5" mid="3DA9" tail="…C426" tone="ok" />
      </div>
      <div className="tour-in tour-d1 flex items-center justify-between gap-3 rounded-xl border border-acc/40 bg-card px-4 py-2.5 sm:rounded-2xl">
        <span className="text-[12px] text-fg3 sm:text-[14px]">Invoice</span>
        <Addr head="0xC1A5" mid="d69D" tail="…C426" tone="bad" />
      </div>
      <div className="tour-pop tour-d2 flex justify-center pt-1">
        <Badge tone="bad">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" /> Lookalike · blocked
        </Badge>
      </div>
    </div>
  )
}

function ScamScene() {
  return (
    <div className={sceneCard}>
      <div className="flex items-center justify-between gap-3 text-[12px] text-fg3 sm:text-[13.5px]">
        <span className="truncate">
          From <span className="tour-mark rounded px-0.5 text-acc2">billing@acme-ltd.co</span>
        </span>
        <span className="font-mono">09:41</span>
      </div>
      <p className="mt-2 text-[13.5px] leading-snug text-fg sm:text-[15.5px]">&ldquo;We changed our wallet. Please pay invoice #2291 to:&rdquo;</p>
      <p className="tour-late mt-2 rounded-lg bg-raised px-3 py-1.5">
        <Addr head="0xC1A5" mid="d69D" tail="…C426" tone="bad" />
      </p>
    </div>
  )
}

function ListScene() {
  return (
    <div className="w-[88%] max-w-[420px] space-y-2">
      <div className="tour-in flex items-center justify-between gap-3 rounded-xl border border-line bg-card px-4 py-2.5 sm:rounded-2xl">
        <span className="text-[13px] font-semibold text-fg sm:text-[15px]">Acme Ltd</span>
        <Badge tone="ok">
          <CheckIcon size={11} /> Approved
        </Badge>
      </div>
      <div className="tour-in tour-d1 flex items-center justify-between gap-3 rounded-xl border border-acc/40 bg-card px-4 py-2.5 sm:rounded-2xl">
        <Addr head="0xC1A5" mid="d69D" tail="…C426" tone="bad" />
        <span className="tour-pop tour-d2">
          <Badge tone="bad">
            <CrossIcon size={10} /> Refused
          </Badge>
        </span>
      </div>
    </div>
  )
}
