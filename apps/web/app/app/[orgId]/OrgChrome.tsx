'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import type { Overview } from '@/lib/api'
import { addressUrl, txUrl } from '@/lib/chain'
import { periodLabel, usd } from '@/lib/format'
import type { OverviewState } from '@/lib/hooks'
import { Pill } from '@/components/atoms'
import { card, cardTitle, ghostBtn, isTxHash, link, pageTitle, primaryBtn, short, wrap } from '@/components/ui'

/** Dashboard title block: greeting, what's waiting, the org's root/key/limit, and the page actions. */
export function OrgHeader({ o, sub, actions }: { o: Overview; sub?: ReactNode; actions?: ReactNode }) {
  const limit = usd(o.org.limitBase)
  const left = usd(o.remaining)
  return (
    <header className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <h1 className={`${pageTitle} [overflow-wrap:anywhere]`}>Nothing gets past {o.org.name}.</h1>
        {sub && <p className="mt-4 text-base text-fg2 sm:text-[17px]">{sub}</p>}
        <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[14px] text-fg3">
          <span>
            Root{' '}
            <a href={addressUrl(o.org.rootAddress)} target="_blank" rel="noreferrer" className={`font-mono text-[12.5px] ${link}`}>
              {short(o.org.rootAddress)}
            </a>
          </span>
          <span>
            Agent key <span className="font-mono text-[12.5px]">{short(o.org.agentKeyAddress)}</span>
          </span>
          {limit && (
            <span>
              {limit} per {periodLabel(o.org.periodSeconds)}
              {left && o.org.authorized ? ` · ${left} left` : ''}
            </span>
          )}
          {isTxHash(o.org.authorizeTx) && (
            <a href={txUrl(o.org.authorizeTx)} target="_blank" rel="noreferrer" className={link}>
              Key authorized ↗
            </a>
          )}
        </p>
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
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
    <div
      className={`flex flex-col gap-2 rounded-card border p-6 text-[15px] leading-relaxed text-fg2 sm:px-8 ${tone === 'red' ? 'border-acc/50 bg-acc/10' : 'border-amber/40 bg-amber/[0.07]'}`}
      role="status"
    >
      <p className={`flex items-center gap-2.5 text-lg font-semibold ${tone === 'red' ? 'text-acc2' : 'text-fg'}`}>
        <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${tone === 'red' ? 'bg-acc' : 'bg-amber'}`} />
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
    <main className={`${wrap} flex flex-1 flex-col items-center py-12 sm:py-20`}>
      <div className={`${card} flex w-full max-w-xl flex-col gap-4`}>
        <div>
          <Pill tone={settled || error ? 'amber' : 'grey'} dot={!settled && !error ? 'bg-current live-dot' : undefined}>
            Organization
          </Pill>
        </div>
        <p className={`mt-2 ${cardTitle}`}>{title}</p>
        <p className="font-mono text-[12.5px] text-fg3 [overflow-wrap:anywhere]">{orgId}</p>
        {body && <div className="text-[15px] leading-relaxed text-fg2">{body}</div>}
        {settled && (
          <Link href="/app" className={`${ghostBtn} mt-2`}>
            Your organizations
          </Link>
        )}
      </div>
    </main>
  )
}
