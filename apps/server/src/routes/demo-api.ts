import { Router, type Express, type RequestHandler } from 'express'
import { z } from 'zod'
import { count, eq, gt } from 'drizzle-orm'
import { createClient, getAddress, http, isAddress, isHex, publicActions, type Address, type Hex } from 'viem'
import { Mppx, tempo } from 'mppx/client'
import { Mppx as ServerMppx, tempo as tempoServer } from 'mppx/express'
import { Receipt } from 'mppx'
import { agentAccount, decodeTempoError, formatAmount, getNetwork, memoFromInvoice, txUrl, type GuardDecision } from '@bound/core'
import { createGuardedFetch, PaymentBlockedError, type MppxLike } from '@bound/sdk'
import { decryptSecret, newId } from '../crypto'
import { demoApiRuns, orgs } from '../db/schema'
import { HOUR, perIpLimit } from '../rate-limit'
import { nowSeconds } from '../services/events'
import { withOrgLock } from '../services/mutex'
import type { ServiceDeps } from '../services/payments'
import { verifyService, type VerifyOutput } from '../services/verify-service'
import { demoAllowed } from './demo'

/** Tempo Moderato: the only chain the demo paid API and its runs ever touch. */
const TESTNET_CHAIN_ID = 42431
/** The service the agent means to pay. Caller configuration (never read from the API's answer): the registered Acme demo payee. */
export const DEMO_API_SERVICE = 'acme.example'
export const DEMO_API_DATA = 'Q4 supplier price index: 1.07'
const PRICE = '0.01'
const DATA_PATH = '/demo/api/data'
/** Upper bound on each HTTP leg of a run (the paid leg includes the API broadcasting the payment and waiting for its receipt). */
const LEG_TIMEOUT_MS = 60_000
/** Upper bound on waiting for the receipt of a possibly-broadcast evidence transaction. */
const EVIDENCE_RECEIPT_MS = 20_000

const DEMO_UNAVAILABLE = "The public demo isn't set up on this server."
const DEMO_API_BUSY = "The paid-API demo has used up today's runs. Try again tomorrow."
const FAILED = 'The demo run could not finish. Try again in a minute.'
const DAY_SECONDS = 86_400

const body = z.object({ hijacked: z.boolean(), guardOff: z.boolean() }).strict()

export type ApiRunStep = { kind: 'request' | 'challenge' | 'check' | 'decision' | 'sign' | 'result'; text: string; data?: unknown }
export type ApiRunOutcome = 'paid' | 'blocked_by_bound' | 'blocked_by_tempo' | 'failed'
export type ApiRunResult = {
  steps: ApiRunStep[]
  outcome: ApiRunOutcome
  recipient: string
  txHash: string | null
  txUrl: string | null
  /** one plain sentence for the page */
  message: string
}

/** Sends the guard-off evidence: the refused transfer, forced onchain so it is mined and reverts. Returns its hash, or null. */
export type EvidenceFn = (p: { orgId: string; to: Address; amount: bigint }) => Promise<Hex | null>
/** The payment client a run drives: the public demo org's mppx client (`polyfill: false`). */
export type PaymentClientFactory = (orgId: string) => MppxLike

/** Injected so tests touch no key, chain or network. */
export type DemoApiInject = {
  /** fetch the default payment client uses (default: global fetch) */
  fetchImpl?: typeof fetch
  /** default: mppx/client tempo.charge with the public demo org's agent access key, on Moderato only */
  paymentClient?: PaymentClientFactory
  /** default: forced transferWithMemo through ChainOps (core forceSendWithKey), testnet only, and only when Tempo will refuse it */
  sendEvidence?: EvidenceFn
}

type Status = { status: 'ready' | 'unavailable' | 'busy'; message: string | null }
type Ready = Status & { orgId?: string; payee?: Address; lookalike?: Address }

/** A Moderato client for mppx; any other chain is refused. */
function moderatoGetClient() {
  const net = getNetwork('testnet')
  if (net.chain.id !== TESTNET_CHAIN_ID) throw new Error(`unexpected testnet chain id ${net.chain.id}`)
  let client: ReturnType<typeof make> | undefined
  function make() { return createClient({ chain: net.chain, transport: http(net.rpc) }).extend(publicActions) }
  return ({ chainId }: { chainId?: number | undefined } = {}) => {
    if (chainId !== undefined && chainId !== TESTNET_CHAIN_ID) throw new Error(`the demo refuses chain ${chainId}: Tempo testnet (${TESTNET_CHAIN_ID}) only`)
    return (client ??= make())
  }
}

/**
 * Whether a run could start now: the public demo org (DEMO_PUBLIC_ORG_ID, never the filmed DEMO_ORG_ID) is configured and
 * authorized, both demo wallets are known, and DEMO_API_RUNS_PER_DAY has room.
 */
function apiRunStatus(deps: ServiceDeps): Ready {
  const { demoPublicOrgId: id, demoOrgId, demoPayeeAddress: payee, labLookalikeAddress: lookalike } = deps.config
  const org = id && id !== demoOrgId ? deps.db.select().from(orgs).where(eq(orgs.id, id)).get() : undefined
  if (!org?.authorized || !payee || !lookalike || deps.config.network !== 'testnet') return { status: 'unavailable', message: DEMO_UNAVAILABLE }
  const since = nowSeconds() - DAY_SECONDS
  const today = deps.db.select({ n: count() }).from(demoApiRuns).where(gt(demoApiRuns.createdAt, since)).get()?.n ?? 0
  if (today >= deps.config.demoApiRunsPerDay) return { status: 'busy', message: DEMO_API_BUSY }
  return { status: 'ready', message: null, orgId: org.id, payee, lookalike }
}

/** The public demo org's mppx client: its agent access key signs (pull mode, mppx's default), Moderato only. */
function defaultPaymentClient(deps: ServiceDeps, fetchImpl?: typeof fetch): PaymentClientFactory {
  const getClient = moderatoGetClient()
  return (orgId) => {
    const org = deps.db.select().from(orgs).where(eq(orgs.id, orgId)).get()
    if (!org) throw new Error(`Unknown org ${orgId}`)
    const account = agentAccount(decryptSecret(org.agentKeyEnc, deps.config.serverSecret) as Hex, getAddress(org.rootAddress))
    return Mppx.create({
      methods: [tempo.charge({ account, getClient, expectedChainId: TESTNET_CHAIN_ID, allowedChainIds: [TESTNET_CHAIN_ID] })],
      polyfill: false,
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    })
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Guard-off evidence, as the attack lab does it: under the org lock, force-send (no simulation) the same transfer ONLY when
 * the preflight says Tempo will refuse it (CallNotAllowed), so it is mined, reverts and leaves a public hash, and can never
 * move funds. Testnet only. Returns the hash of a reverted transaction, or null.
 */
function defaultEvidence(deps: ServiceDeps): EvidenceFn {
  return async ({ orgId, to, amount }) => {
    if (deps.config.network !== 'testnet' || deps.chain.network !== 'testnet') return null
    const memo = memoFromInvoice('bound-mpp-demo')
    const sent = await withOrgLock(orgId, async (): Promise<{ hash: Hex; status: 'reverted' | 'unknown' } | null> => {
      let pre: Awaited<ReturnType<ServiceDeps['ops']['preflight']>>
      try { pre = await deps.ops.preflight({ orgId, to, amount, memo }) } catch { return null }
      if (pre.ok || pre.code !== 'CallNotAllowed') return null
      try {
        const r = await deps.ops.send({ orgId, to, amount, memo, force: true })
        return r.status === 'reverted' ? { hash: r.txHash, status: 'reverted' } : null
      } catch (e) {
        const maybe = (e as { txHash?: unknown } | null)?.txHash
        return typeof maybe === 'string' && isHex(maybe) ? { hash: maybe, status: 'unknown' } : null
      }
    })
    if (!sent) return null
    if (sent.status === 'reverted') return sent.hash
    // possibly broadcast: link it only once its receipt shows the revert (bounded wait, outside the lock)
    const deadline = Date.now() + EVIDENCE_RECEIPT_MS
    while (Date.now() < deadline) {
      const st = await deps.ops.getReceipt(sent.hash).catch(() => null)
      if (st === 'reverted') return sent.hash
      if (st === 'success') return null
      await sleep(2_000)
    }
    return null
  }
}

const PATHUSD = getNetwork('testnet').token

/** What the run shows of a payment request: amounts in base units and pathUSD, the recipients, the chain. Nothing secret. */
function describeChallenge(c: { method: string; intent: string; request: Record<string, unknown> }) {
  const req = c.request ?? {}
  const details = (req.methodDetails ?? {}) as { chainId?: unknown; splits?: unknown }
  const amountBase = typeof req.amount === 'string' && /^\d{1,30}$/.test(req.amount) ? req.amount : null
  const token = typeof req.currency === 'string' ? req.currency : null
  return {
    method: c.method, intent: c.intent,
    amount: amountBase ? formatAmount(BigInt(amountBase)) : null,
    amountBase,
    currency: token && token.toLowerCase() === PATHUSD.toLowerCase() ? 'pathUSD' : token,
    recipient: typeof req.recipient === 'string' && isAddress(req.recipient) ? getAddress(req.recipient) : null,
    chainId: typeof details.chainId === 'number' ? details.chainId : null,
    splits: Array.isArray(details.splits) ? details.splits.length : 0,
  }
}

/**
 * verifyPayee words some reasons for an invoice ("Invoice claims to be…"). A paid API is not an invoice, so the run rewords
 * them for a payment request; core's wording is left alone. Whatever the rule, the word "invoice" never reaches the page.
 */
const SERVICE_WORDING: [RegExp, string][] = [
  [/^Invoice claims to be (.+) \(verified wallet (0x[0-9a-fA-F]{40})\) but pays an unverified address$/, 'The payment request is for $1 (verified wallet $2) but pays an unverified address'],
  [/^Invoice name uses look-alike characters$/, 'The name uses look-alike characters'],
  [/^Invoice sent from (\S+), which belongs to (.+)$/, '$1 belongs to $2'],
  [/^Invoice sent from (\S+); registered domain is (\S+)$/, '$1 is not the registered domain ($2)'],
]
export function serviceWording(detail: string): string {
  const rule = SERVICE_WORDING.find(([re]) => re.test(detail))
  return (rule ? detail.replace(rule[0], rule[1]) : detail).replace(/invoice/gi, 'payment request')
}

/** The decision's reason for the page: decidePayment's sentence, minus a failed check's error text (that stays in the server log). */
function pageReason(d: GuardDecision): string {
  return serviceWording(d.reason.replace(/^(could not verify [^:]+):[\s\S]*$/, '$1'))
}

function checkText(c: GuardDecision['checks'][number]): string {
  const who = c.recipient.address
  const forWhom = c.recipient.role === 'primary' ? DEMO_API_SERVICE : 'any verified business'
  if (c.error !== undefined || c.verdict === null) return `Bound could not verify ${who}, so the agent will not pay it.`
  if (c.verdict === 'MATCH') return `Bound checks ${who} for ${forWhom}: MATCH, the verified wallet of ${c.payee?.legalName ?? forWhom}.`
  if (c.verdict === 'LOOKALIKE') return `Bound checks ${who} for ${forWhom}: LOOKALIKE, it imitates a verified wallet but is not ${forWhom}'s.`
  return `Bound checks ${who} for ${forWhom}: ${c.verdict}, not the verified wallet of ${forWhom}.`
}

const isPaymentBlocked = (e: unknown): e is PaymentBlockedError => e instanceof PaymentBlockedError || (e as Error | null)?.name === 'PaymentBlockedError'

/** The Payment-Receipt's transaction hash, when the API sent one. */
function receiptHash(res: Response): Hex | null {
  const header = res.headers.get('payment-receipt')
  if (!header) return null
  try {
    const ref = Receipt.deserialize(header).reference
    return typeof ref === 'string' && isHex(ref) && ref.length === 66 ? ref : null
  } catch {
    return null
  }
}

/** The 402 flow without Bound: whatever the API asks is signed (the same steps as createGuardedFetch, minus the check). */
async function unguardedFetch(m: MppxLike, url: string, init: RequestInit): Promise<Response> {
  const first = await m.rawFetch(url, init)
  if (first.status !== 402) return first
  const payment = await m.preparePayment(first, { request: init })
  const credential = await payment.createCredential()
  return m.rawFetch(url, payment.setCredential(init, credential))
}

/**
 * One deterministic public run (no model): an agent step buys the price index from the demo paid API with the public demo
 * org's access key, with Bound's guard on or off, against the honest or the hijacked API. Every step is a plain sentence plus
 * public data (addresses, amounts, verdicts); keys, tokens and error texts never enter the result.
 */
export async function runApiDemo(
  deps: ServiceDeps,
  p: { orgId: string; hijacked: boolean; guardOff: boolean; payee: Address; lookalike: Address },
  inject: DemoApiInject = {},
): Promise<ApiRunResult> {
  const steps: ApiRunStep[] = []
  const step = (kind: ApiRunStep['kind'], text: string, data?: unknown) => { steps.push(data === undefined ? { kind, text } : { kind, text, data }) }
  const path = `/v1${DATA_PATH}${p.hijacked ? '?hijack=1' : ''}`
  const url = `http://127.0.0.1:${deps.config.port}${path}`
  let recipient: Address = p.hijacked ? p.lookalike : p.payee
  let amount = PRICE
  let amountBase = 10_000n
  let signing = false
  const done = (outcome: ApiRunOutcome, message: string, txHash: Hex | null = null): ApiRunResult =>
    ({ steps, outcome, recipient, txHash, txUrl: txHash ? txUrl('testnet', txHash) : null, message })

  try {
    if (deps.config.network !== 'testnet') throw new Error('the paid-API demo runs on Tempo testnet only')
    step('request', 'The agent asks a paid API for the Q4 supplier price index.', { method: 'GET', path, service: DEMO_API_SERVICE })
    const client = (inject.paymentClient ?? defaultPaymentClient(deps, inject.fetchImpl))(p.orgId)

    // Wraps the payment client so the run records what it is asked to pay and when it signs, whichever path drives it.
    const watched: MppxLike = {
      rawFetch: (u, init) => client.rawFetch(u, init),
      async preparePayment(response, opts) {
        const prepared = await client.preparePayment(response, opts)
        const c = describeChallenge(prepared.challenge)
        if (c.recipient) recipient = c.recipient
        if (c.amount && c.amountBase) { amount = c.amount; amountBase = BigInt(c.amountBase) }
        step('challenge', `The API answers 402 Payment Required: pay ${c.amount ?? '?'} ${c.currency ?? ''} to ${c.recipient ?? 'an unreadable recipient'}.`.replace(/ {2,}/g, ' '), c)
        if (p.guardOff) step('decision', "Bound is off: nothing checks who the API wants paid, so the agent's payment client pays it.", { guard: 'off' })
        return {
          ...prepared,
          createCredential: async () => {
            signing = true
            step('sign', `The agent signs a payment of ${amount} pathUSD to ${recipient} with its Tempo access key.`, { amount, recipient })
            return prepared.createCredential()
          },
        }
      },
    }
    const init: RequestInit = { signal: AbortSignal.timeout(LEG_TIMEOUT_MS) }

    let res: Response
    if (p.guardOff) {
      res = await unguardedFetch(watched, url, init)
    } else {
      // in-process Bound client: verifyService directly, no HTTP round trip
      const verified = new Map<string, VerifyOutput>()
      const bound = {
        async verifyService(i: { address: string; domain?: string }) {
          const out = await verifyService(deps, { address: getAddress(i.address), domain: i.domain })
          verified.set(i.address.toLowerCase(), out)
          return out
        },
      }
      const guarded = createGuardedFetch({
        bound, mppx: watched, serviceDomain: DEMO_API_SERVICE, expectedChainId: TESTNET_CHAIN_ID,
        // the page's steps come from the guard's decision; Bound's reasons are reworded for a payment request
        onDecision: (d) => {
          for (const c of d.checks) {
            const reasons = (verified.get(c.recipient.address.toLowerCase())?.reasons ?? []).map((r) => ({ code: r.code, detail: serviceWording(r.detail) }))
            step('check', checkText(c), { address: c.recipient.address, role: c.recipient.role, verdict: c.verdict, payee: c.payee, reasons })
          }
          const reason = pageReason(d)
          step('decision', d.allow ? 'Bound allows the payment: every recipient is verified.' : `Bound blocks the payment before anything is signed: ${reason}.`, { allow: d.allow, reason })
        },
      })
      res = await guarded(url, init)
    }

    if (res.status === 200 && signing) {
      const json: any = await res.json().catch(() => null)
      const data = typeof json?.data === 'string' ? json.data : null
      const hash = receiptHash(res)
      step('result', `Paid. The API returned the data: ${data ?? '(empty)'}`, { status: 200, data, txHash: hash, txUrl: hash ? txUrl('testnet', hash) : null })
      return done('paid', p.guardOff
        ? `With Bound off, the agent paid ${amount} pathUSD; this time the API happened to be honest.`
        : `Bound confirmed ${recipient} is ${DEMO_API_SERVICE}'s verified wallet, so the agent paid ${amount} pathUSD and got the data.`, hash)
    }
    step('result', `The API answered HTTP ${res.status} without the data.`, { status: res.status })
    return done('failed', FAILED)
  } catch (e) {
    if (isPaymentBlocked(e)) {
      step('result', 'Nothing was signed and no money moved.')
      return done('blocked_by_bound', `Bound stopped the payment before signing: ${pageReason(e.decision)}.`)
    }
    if (signing && decodeTempoError(e).code === 'CallNotAllowed') {
      // Tempo refused it while the transaction was prepared: nothing was broadcast, so there is no hash. With the guard off, the
      // same transfer is force-sent so the page can link a mined, reverted transaction.
      let hash: Hex | null = null
      if (p.guardOff) {
        try {
          hash = await (inject.sendEvidence ?? defaultEvidence(deps))({ orgId: p.orgId, to: recipient, amount: amountBase })
        } catch (err) {
          console.error('[demo-api] evidence transaction failed', err)
        }
      }
      step('result',
        `Tempo refused the payment: the agent's key may only pay approved wallets (CallNotAllowed). No money moved.${hash ? ' The same transfer sent straight to the chain was mined and reverted.' : ''}`,
        { code: 'CallNotAllowed', txHash: hash, txUrl: hash ? txUrl('testnet', hash) : null })
      return done('blocked_by_tempo', "Tempo refused the payment because the agent's key may only pay approved wallets, so no money moved.", hash)
    }
    console.error('[demo-api] run failed', e)
    step('result', 'The run stopped before it finished.')
    return done('failed', FAILED)
  }
}

export type DemoApiLimits = { flood?: RequestHandler; perIp?: RequestHandler }

/**
 * The paid-API demo (testnet only): GET /v1/demo/api/data[?hijack=1] is a real MPP paid API (mppx tempo.charge, 0.01 pathUSD to
 * the Acme demo payee, or to the lab lookalike when hijacked); POST /v1/demo/api-runs { hijacked, guardOff } runs one public,
 * deterministic purchase from it on the public demo org and answers with the whole run; GET /v1/demo/api-runs/status says
 * whether a run could start. Abuse limits: a per-IP flood guard, DEMO_RUNS_PER_IP_HOUR runs per IP, DEMO_API_RUNS_PER_DAY for everyone.
 */
export function demoApiRouter(deps: ServiceDeps, inject: DemoApiInject = {}, limits: DemoApiLimits = {}) {
  const r = Router()
  const { demoRunsPerIpHour: perHour } = deps.config
  const flood = limits.flood ?? perIpLimit(120, undefined, 'Too many requests. Slow down and try again in a minute.')
  const perIp = limits.perIp ?? perIpLimit(perHour, HOUR, `You've used this hour's ${perHour} demo runs. Try again a little later.`)
  const getClient = moderatoGetClient()
  const api = ServerMppx.create({
    methods: [tempoServer.charge({ testnet: true, currency: PATHUSD, getClient })],
    secretKey: deps.config.mppSecretKey,
    realm: 'bound-demo-api',
  })

  r.get(DATA_PATH, flood, (req, res, next) => {
    const { demoPayeeAddress: payee, labLookalikeAddress: lookalike } = deps.config
    if (!payee || !lookalike) return void res.status(503).json({ error: DEMO_UNAVAILABLE, code: 'unavailable' })
    const recipient = req.query.hijack === '1' ? lookalike : payee
    return api.charge({ amount: PRICE, currency: PATHUSD, recipient, description: 'Q4 supplier price index' })(req, res, next)
  }, (_req, res) => { res.json({ data: DEMO_API_DATA }) })

  r.get('/demo/api-runs/status', flood, (_req, res) => {
    const { status, message } = apiRunStatus(deps)
    res.json({ status, message, runsPerHour: perHour })
  })

  // Refuses before validation when no run could start, and validates before the per-IP limit so a rejected body
  // doesn't cost one of the hour's runs.
  const ready: RequestHandler = (req, res, next) => {
    const s = apiRunStatus(deps)
    if (s.status === 'unavailable') return void res.status(503).json({ error: s.message, code: s.status })
    if (s.status === 'busy') return void res.status(429).json({ error: s.message, code: s.status })
    res.locals.apiRun = { orgId: s.orgId!, payee: s.payee!, lookalike: s.lookalike!, ...body.parse(req.body) }
    next()
  }

  r.post('/demo/api-runs', flood, ready, perIp, async (_req, res) => {
    const b: z.infer<typeof body> & { orgId: string; payee: Address; lookalike: Address } = res.locals.apiRun
    // recorded before the run starts, so concurrent runs count against the daily cap
    const id = newId('dar', 16)
    deps.db.insert(demoApiRuns).values({ id, hijacked: b.hijacked ? 1 : 0, guardOff: b.guardOff ? 1 : 0, outcome: 'running', txHash: null, createdAt: nowSeconds() }).run()
    let result: ApiRunResult
    try {
      result = await runApiDemo(deps, b, inject)
    } catch (e) {
      console.error('[demo-api] run crashed', e)
      result = { steps: [], outcome: 'failed', recipient: b.hijacked ? b.lookalike : b.payee, txHash: null, txUrl: null, message: FAILED }
    }
    deps.db.update(demoApiRuns).set({ outcome: result.outcome, txHash: result.txHash }).where(eq(demoApiRuns.id, id)).run()
    res.json(result)
  })

  return r
}

/** Mounts the paid-API demo with the public demo's rules (testnet only, never mainnet even with LAB_ENABLED). Returns whether it was mounted. */
export function mountDemoApi(app: Express, deps: ServiceDeps, inject?: DemoApiInject, limits?: DemoApiLimits): boolean {
  if (!demoAllowed(deps.config) || deps.config.network !== 'testnet') return false
  app.use('/v1', demoApiRouter(deps, inject, limits))
  return true
}
