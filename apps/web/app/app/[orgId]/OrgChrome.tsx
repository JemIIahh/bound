'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import type { Overview } from '@/lib/api'
import { addressUrl, txUrl } from '@/lib/chain'
import { periodLabel, usd } from '@/lib/format'
import type { OverviewState } from '@/lib/hooks'
import { card, ghostBtn, primaryBtn, sectionLabel, short } from '@/components/ui'

const link = 'underline decoration-fg3/50 underline-offset-4 hover:text-fg'

/** Page title block shared by the dashboard and the lab: org name, root, key, limit. */
export function OrgHeader({ o, eyebrow, action }: { o: Overview; eyebrow: string; action?: ReactNode }) {
  const limit = usd(o.org.limitBase)
  const left = usd(o.remaining)
  return (
    <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <p className={`${sectionLabel} mb-4`}>{eyebrow}</p>
        <h1 className="font-display text-4xl font-medium leading-[1.1] tracking-[-0.02em] text-fg [overflow-wrap:anywhere] sm:text-5xl">{o.org.name}</h1>
        <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[12.5px] text-fg3">
          <span>
            Root{' '}
            <a href={addressUrl(o.org.rootAddress)} target="_blank" rel="noreferrer" className={link}>
              {short(o.org.rootAddress)}
            </a>
          </span>
          <span>Agent key {short(o.org.agentKeyAddress)}</span>
          {limit && (
            <span>
              {limit} per {periodLabel(o.org.periodSeconds)}
              {left && o.org.authorized ? ` · ${left} left` : ''}
            </span>
          )}
          {o.org.authorizeTx && (
            <a href={txUrl(o.org.authorizeTx)} target="_blank" rel="noreferrer" className={link}>
              Key authorized ↗
            </a>
          )}
        </p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  )
}

/** Key problems the payer must know about before anything else. */
export function KeyNotice({ o }: { o: Overview }) {
  if (!o.org.authorized)
    return (
      <Notice title="The agent key isn't authorized yet">
        <p>Payments are off until you sign the authorization with your root wallet.</p>
        <Link href="/app" className={`${primaryBtn} mt-4 self-start sm:w-auto sm:px-8`}>
          Finish setup
        </Link>
      </Notice>
    )
  if (o.keyStatus === 'unrestricted')
    return (
      <Notice title="The agent key can pay anyone" tone="red">
        <p>It has no recipient restriction on Tempo, so Bound won&apos;t pay with it. Re-authorize the key with a recipient list.</p>
      </Notice>
    )
  if (o.keyStatus === 'unavailable')
    return (
      <Notice title="Couldn't read the agent key from Tempo">
        <p>The allowlist and remaining limit may be out of date. Bound keeps trying.</p>
      </Notice>
    )
  return null
}

function Notice({ title, tone, children }: { title: string; tone?: 'red'; children: ReactNode }) {
  return (
    <div className={`${card} flex flex-col gap-2 text-sm leading-relaxed text-fg3`} role="status">
      <p className="flex items-center gap-2.5 text-base text-fg">
        <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${tone === 'red' ? 'bg-acc' : 'bg-amber'}`} />
        {title}
      </p>
      {children}
    </div>
  )
}

/** Loading, no token in this browser, token refused, or API down (before the first overview). */
export function OrgGate({ orgId, state }: { orgId: string; state: OverviewState }) {
  const { access, error } = state
  let title = 'Loading…'
  let body: ReactNode = null
  if (access === 'no-token') {
    title = "This browser can't open this organization"
    body = <p>Organizations open in the browser that created them. Set up a new one, or open this page where you created it.</p>
  } else if (access === 'denied') {
    title = "Bound didn't accept this browser's key"
    body = <p>The saved key for this organization is no longer valid, or the organization doesn&apos;t exist on this server.</p>
  } else if (error) {
    title = "Couldn't load the dashboard"
    body = <p>{error} Retrying every few seconds.</p>
  }
  const settled = access === 'no-token' || access === 'denied'
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-5 py-16 sm:px-8">
      <div className={`${card} flex flex-col gap-3`}>
        <span className={sectionLabel}>Organization</span>
        <p className="flex items-center gap-3 font-display text-2xl tracking-[-0.01em] text-fg">
          {!settled && !error && <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-fg" />}
          {title}
        </p>
        <p className="font-mono text-[12.5px] text-fg3 [overflow-wrap:anywhere]">{orgId}</p>
        {body && <div className="text-sm leading-relaxed text-fg3">{body}</div>}
        {settled && (
          <Link href="/app" className={`${ghostBtn} mt-2`}>
            Your organizations
          </Link>
        )}
      </div>
    </main>
  )
}
