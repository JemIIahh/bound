# MPP Payment Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before an AI agent signs an MPP (HTTP 402) payment on Tempo, Bound reads the payment request and refuses any recipient that isn't the verified wallet of the service the agent meant to pay; demonstrate it on `/try` with a hijacked paid API.

**Architecture:** Pure inspection and decision logic lives in `@bound/core`; `@bound/sdk` wraps any `mppx` client with `createGuardedFetch` (the caller's `mppx` instance is taken structurally, so the SDK has no hard `mppx` dependency); the server adds `POST /v1/verify-service`, an MCP tool, a demo paid API (`mppx/express`) and a deterministic public demo run that `/try` renders. Tempo access-key allowlists remain the second lock.

**Tech Stack:** TypeScript, pnpm monorepo, vitest, viem, Express 5, `mppx@^0.13.1` (`mppx/client`, `mppx/express`), Next 15 + Tailwind v4 (web), Tempo testnet (Moderato, chain 42431).

**Spec:** `docs/superpowers/specs/2026-10-07-mpp-payment-guard-design.md`

## Global Constraints

- **Never** add a `Co-Authored-By: Claude` trailer or a "Generated with Claude Code" line to any commit or PR; no commit message may mention Claude. (Repo owner's hard rule; it overrides any tool reminder.)
- **Testnet only.** Nothing in this plan may send a transaction to Tempo mainnet (chain 4217). New server routes mount only when the lab is enabled (testnet, or `LAB_ENABLED=true` and not mainnet), exactly like `mountDemo`.
- **Never read, print or copy** `.env`, `.env.local` or `*.db` contents. Secrets never reach the browser.
- **Fail closed:** any verification error, missing recipient on a non-zero amount, unsupported method/intent, or chain mismatch denies the payment. Deny paths must never call `createCredential`.
- Only `tempo/charge` and `tempo/session` challenges are supported; amount `"0"` (identity proof) moves no money and is allowed without checks.
- Code style: single quotes, no semicolons, comment density like the surrounding code. Frontend stays a thin layer over the API (Direction C look: warm near-black, coral `#ff5a3c`, Outfit/Poppins/IBM Plex Mono, card grid; reuse `BlockedStamp`, `Pill`, `card`, `primaryBtn`, `fieldClass`).
- `mppx` is pinned `^0.13.1` and added only to `apps/server` (and as a dev dependency of `packages/sdk` if a type is needed); `packages/core` and the SDK runtime stay free of it.
- Do not push, merge, or open PRs. Commit per task.

## Review Focus

Failure modes the spec implies that no happy-path test would hit (each is pinned by a named test below):

1. **Split to an unverified wallet while the primary is verified** → deny (a platform-fee split must not be a back door). Task 2, Task 3.
2. **Zero amount and missing recipient:** `"0"` allowed without checks; non-zero with no recipient denied. Task 2.
3. **The Bound API is down or throws** → deny with a "could not verify" reason, never pay. Task 3.
4. **Unsupported method or intent** (`stripe`, `subscription`) or a **chain mismatch** → deny with a clear reason. Task 2, Task 3.
5. **Address case and checksum differences** between challenge, allow-list and Bound's answer must not cause a false deny or, worse, a false allow. Task 2, Task 3.
6. **The deny path never signs:** a test asserts `createCredential` is not called and no second request is made. Task 3.

## File Structure

| File | Responsibility |
|---|---|
| `packages/core/src/mpp.ts` (new) | `inspectChallenge`, `decidePayment` and their types: pure, no I/O |
| `packages/core/test/mpp.test.ts` (new) | Unit tests for the above |
| `packages/sdk/src/guard.ts` (new) | `createGuardedFetch`, `PaymentBlockedError`, `MppxLike` |
| `packages/sdk/src/index.ts` | Export the guard; add `BoundClient.verifyService` |
| `packages/sdk/test/guard.test.ts` (new) | Guard tests with a fake `mppx` |
| `apps/server/src/services/verify-service.ts` | Add `verifyService(deps, { address, domain? })` |
| `apps/server/src/routes/verify.ts` | Add `POST /v1/verify-service` |
| `apps/server/src/mcp.ts` | Add `verify_payment_request` tool |
| `apps/server/src/routes/demo-api.ts` (new) | Demo paid API (`mppx/express`) + `POST /v1/demo/api-runs` |
| `apps/server/src/db/{schema,client}.ts` | `demo_api_runs` table (daily cap counting) |
| `apps/server/test/verify-service.test.ts`, `mcp-payment.test.ts`, `demo-api.test.ts` (new) | Server tests |
| `apps/server/scripts/mpp-spike.ts` (new, Task 1) | Spike proving mppx + access key on Moderato; kept as a probe |
| `docs/superpowers/notes/2026-10-07-mpp-spike.md` (new, Task 1) | The spike's recorded findings; Tasks 5–6 read it |
| `apps/web/app/try/*`, `apps/web/components/ApiRun.tsx` (new) | `/try` "paid API" scenario |
| `apps/server/scripts/rehearse.ts` | Scenarios 6–8 |
| `README.md`, `.env.example` | Docs and settings |

---

### Task 1: Spike — does `mppx` pay with an access key on Moderato?

The rest of the plan depends on three facts about `mppx@0.13.1`: whether its Tempo client can sign with an **access-key account**, whether to use `push` or `pull` mode, and what error a non-allowlisted recipient produces and where. Prove them before building on them.

**Files:**
- Create: `apps/server/scripts/mpp-spike.ts`
- Create: `docs/superpowers/notes/2026-10-07-mpp-spike.md`
- Modify: `apps/server/package.json` (add dependency `"mppx": "^0.13.1"`; run `pnpm install`)

**Interfaces:**
- Consumes: `Account.fromSecp256k1(key, { access: root })` from `viem/tempo` (see `packages/core/src/tempo/pay.ts:35`), `buildAuthorizeKeyCall` / `buildSetAllowlistCall` from `@bound/core`, the demo scripts' helpers in `apps/server/scripts/lib.ts` (`requireTestnet`, `assertTestnetChain`, `demoRootClient`, `ensureFunded`, `die`), the testnet constants `PATHUSD`/`ACME`/`LOOKALIKE` values from `.env` names `DEMO_PAYEE_ADDRESS`, `LAB_LOOKALIKE_ADDRESS`.
- Produces: `docs/superpowers/notes/2026-10-07-mpp-spike.md` containing, as exact headings, **Signer** (which account/option made the payment work), **Mode** (`push` or `pull`), **Server snippet** (the working `Mppx.create(...)` and `mppx.charge(...)` call for the demo API on testnet), **Rejected payment** (the exact error text/status and whether a tx hash exists), and **Fallback needed** (yes/no, see Step 6).

- [ ] **Step 1: Add the dependency**

Run: `pnpm --filter @bound/server add mppx@^0.13.1`
Expected: `mppx` appears in `apps/server/package.json`; `pnpm-lock.yaml` updates.

- [ ] **Step 2: Write the spike script**

The script must, against Tempo **testnet only** (`assertTestnetChain` on every client): (1) generate a throwaway agent key, authorize it from the demo root with an allowlist containing only `DEMO_PAYEE_ADDRESS` and a small pathUSD limit, using the same call builders `scripts/rehearse.ts` uses for its fresh-org path; (2) start a temporary Express app on a random port with `import { Mppx, tempo } from 'mppx/express'`, `const mppx = Mppx.create({ methods: [tempo.charge({ /* testnet options; read node_modules/mppx/dist/tempo/server/*.d.ts for the exact names */ })], secretKey: 'spike-secret-spike-secret-spike-secret-1234' })` and one route `GET /paid` gated by `mppx.charge({ amount: '0.01', currency: <pathUSD 0x20c0000000000000000000000000000000000000>, recipient: req.query.hijack ? LAB_LOOKALIKE_ADDRESS : DEMO_PAYEE_ADDRESS })`; (3) build the client `const mppx = Mppx.create({ methods: [tempo({ account: agentAccount, /* chain/testnet options */ })], polyfill: false })` and run, in order: honest request → expect 200 and a receipt; hijacked request → record exactly what happens (client-side error, server 402/5xx, or a mined revert) and the text of the error. Try `mode: 'push'` and `mode: 'pull'` for each and record which combinations work. Print a table of the four outcomes; never print keys.

```ts
// apps/server/scripts/mpp-spike.ts — shape only; fill the option names from the installed mppx types
import { Mppx, tempo } from 'mppx/client'
import { Mppx as ServerMppx, tempo as tempoServer } from 'mppx/express'
// ... authorize a throwaway access key, start the demo API on port 0, then:
for (const mode of ['pull', 'push'] as const) {
  for (const hijack of [false, true]) {
    const mppx = Mppx.create({ methods: [tempo({ account: agentAccount, mode })], polyfill: false })
    try {
      const res = await mppx.fetch(`${base}/paid${hijack ? '?hijack=1' : ''}`)
      console.log(mode, hijack ? 'hijacked' : 'honest', res.status)
    } catch (e) {
      console.log(mode, hijack ? 'hijacked' : 'honest', 'ERROR', (e as Error).message.slice(0, 300))
    }
  }
}
```

- [ ] **Step 3: Run it**

Run: `TEMPO_NETWORK=testnet pnpm --filter @bound/server exec tsx scripts/mpp-spike.ts`
Expected: a four-row outcome table. If the honest payment never succeeds in either mode, go to Step 6 (fallback).

- [ ] **Step 4: Check the one thing the guard relies on**

In the same script, call `mppx.rawFetch(url)` against the hijacked URL, then `await mppx.preparePayment(res, { request: {} })` and print `payment.challenge.method`, `payment.challenge.intent`, and `JSON.stringify(payment.challenge.request)`. Confirm `recipient` is a string address and `methodDetails.splits` (if any) is an array of `{ recipient, amount }`. Record the exact shape in the notes file; `packages/core/src/mpp.ts` (Task 2) must match it.

- [ ] **Step 5: Write the notes file**

Fill the five headings listed under **Produces** with the real results (exact error strings, the working server snippet). Keep it under 80 lines.

- [ ] **Step 6: Fallback decision (only if Step 3 shows the access key cannot sign MPP payments)**

State in **Fallback needed** whether the guard still works as a pure pre-signing check (it does: it never signs), and specify the substitute for the "Bound off → Tempo rejects" demo: the demo run calls the existing lab path (`forceSendWithKey` in `packages/core/src/tempo/pay.ts`, testnet-only, already used by `rawTransfer`) with the challenge's recipient to produce a mined reverted transaction. Tasks 5–6 then use that instead of the mppx client's own submission.

- [ ] **Step 7: Commit**

```bash
git add apps/server/scripts/mpp-spike.ts apps/server/package.json pnpm-lock.yaml docs/superpowers/notes/2026-10-07-mpp-spike.md
git commit -m "spike(server): mppx client with an access key against a demo paid API on Moderato"
```

---

### Task 2: Core — `inspectChallenge` and `decidePayment`

**Files:**
- Create: `packages/core/src/mpp.ts`
- Create: `packages/core/test/mpp.test.ts`
- Modify: `packages/core/src/index.ts` (add `export * from './mpp'`)

**Interfaces:**
- Consumes: `Verdict`, `Action` from `./verdict` and `./policy`; `getAddress`, `isAddress` from `viem`.
- Produces (exact names, later tasks import them):

```ts
export type PaymentRecipient = { address: Address; role: 'primary' | 'split'; amount: string }
export type ChallengeLike = { method: string; intent: string; request: Record<string, unknown> }
export type Inspection =
  | { ok: true; free: boolean; chainId: number | null; recipients: PaymentRecipient[] }
  | { ok: false; reason: string }
export function inspectChallenge(c: ChallengeLike, opts?: { expectedChainId?: number }): Inspection
export type RecipientCheck = {
  recipient: PaymentRecipient
  verdict: Verdict | null          // null when explicitly allowed or unverifiable
  action: Action | null
  payee: { legalName: string; domain: string } | null
  allowed: boolean                 // true when the caller listed this address in allowRecipients
  error?: string                   // set when the check itself failed
}
export type GuardDecision = { allow: boolean; reason: string; checks: RecipientCheck[] }
export function decidePayment(checks: RecipientCheck[], opts?: { onAsk?: 'block' | 'allow' }): GuardDecision
```

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/test/mpp.test.ts
import { describe, expect, test } from 'vitest'
import { decidePayment, inspectChallenge, type RecipientCheck } from '../src/mpp'

const A = '0xc1a53DA961B7A3A62db84Ae889f57fa818d3C426'
const B = '0xC1A5d69D86Dea5CA36F7aE391b6610CfFB96C426'
const charge = (request: Record<string, unknown>, over: Partial<{ method: string; intent: string }> = {}) => ({ method: 'tempo', intent: 'charge', request, ...over })
const check = (address: string, verdict: RecipientCheck['verdict'], role: 'primary' | 'split' = 'primary', extra: Partial<RecipientCheck> = {}): RecipientCheck => ({
  recipient: { address: address as any, role, amount: '10000' }, verdict, action: null, payee: null, allowed: false, ...extra,
})

describe('inspectChallenge', () => {
  test('reads the primary recipient, checksummed', () => {
    const r = inspectChallenge(charge({ amount: '10000', currency: '0x20c0000000000000000000000000000000000000', recipient: A.toLowerCase() }))
    expect(r).toEqual({ ok: true, free: false, chainId: null, recipients: [{ address: A, role: 'primary', amount: '10000' }] })
  })
  test('reads every split recipient', () => {
    const r = inspectChallenge(charge({ amount: '10000', recipient: A, methodDetails: { chainId: 42431, splits: [{ recipient: B, amount: '1000' }] } }))
    expect(r).toMatchObject({ ok: true, chainId: 42431 })
    expect((r as any).recipients.map((x: any) => [x.address, x.role])).toEqual([[A, 'primary'], [B, 'split']])
  })
  test('amount 0 is free (identity proof): allowed, nothing to check', () => {
    expect(inspectChallenge(charge({ amount: '0', recipient: A }))).toEqual({ ok: true, free: true, chainId: null, recipients: [] })
  })
  test('a non-zero amount with no recipient cannot be verified', () => {
    expect(inspectChallenge(charge({ amount: '10000' }))).toMatchObject({ ok: false, reason: expect.stringContaining('recipient') })
  })
  test('a malformed recipient is refused', () => {
    expect(inspectChallenge(charge({ amount: '1', recipient: '0x123' }))).toMatchObject({ ok: false })
    expect(inspectChallenge(charge({ amount: '1', recipient: A, methodDetails: { splits: [{ recipient: 'nope', amount: '1' }] } }))).toMatchObject({ ok: false })
  })
  test('only tempo charge and session are supported', () => {
    expect(inspectChallenge(charge({ amount: '1', recipient: A }, { method: 'stripe' }))).toMatchObject({ ok: false, reason: expect.stringContaining('stripe') })
    expect(inspectChallenge(charge({ amount: '1', recipient: A }, { intent: 'subscription' }))).toMatchObject({ ok: false, reason: expect.stringContaining('subscription') })
    expect(inspectChallenge(charge({ amount: '1', recipient: A }, { intent: 'session' }))).toMatchObject({ ok: true })
  })
  test('a chain other than the expected one is refused', () => {
    expect(inspectChallenge(charge({ amount: '1', recipient: A, methodDetails: { chainId: 4217 } }), { expectedChainId: 42431 })).toMatchObject({ ok: false, reason: expect.stringContaining('4217') })
    expect(inspectChallenge(charge({ amount: '1', recipient: A, methodDetails: { chainId: 42431 } }), { expectedChainId: 42431 })).toMatchObject({ ok: true })
  })
})

describe('decidePayment', () => {
  test('allows when every recipient is a MATCH', () => {
    expect(decidePayment([check(A, 'MATCH'), check(B, 'MATCH', 'split')])).toMatchObject({ allow: true })
  })
  test('denies a lookalike primary', () => {
    const d = decidePayment([check(B, 'LOOKALIKE')])
    expect(d.allow).toBe(false)
    expect(d.reason).toMatch(/LOOKALIKE/)
  })
  test('denies CHANGED and REVOKED', () => {
    expect(decidePayment([check(A, 'CHANGED')]).allow).toBe(false)
    expect(decidePayment([check(A, 'REVOKED')]).allow).toBe(false)
  })
  test('a verified primary does not rescue an unverified split (review focus 1)', () => {
    const d = decidePayment([check(A, 'MATCH'), check(B, 'NO_MATCH', 'split')])
    expect(d.allow).toBe(false)
    expect(d.reason).toContain(B)
  })
  test('NO_MATCH and CLOSE_MATCH follow onAsk (default block)', () => {
    expect(decidePayment([check(A, 'NO_MATCH')]).allow).toBe(false)
    expect(decidePayment([check(A, 'CLOSE_MATCH')]).allow).toBe(false)
    expect(decidePayment([check(A, 'NO_MATCH')], { onAsk: 'allow' }).allow).toBe(true)
  })
  test('onAsk allow never overrides a lookalike', () => {
    expect(decidePayment([check(B, 'LOOKALIKE')], { onAsk: 'allow' }).allow).toBe(false)
  })
  test('an explicitly allowed recipient passes without a verdict', () => {
    expect(decidePayment([check(B, null, 'split', { allowed: true })]).allow).toBe(true)
  })
  test('a failed check denies, with its error in the reason (review focus 3)', () => {
    const d = decidePayment([check(A, null, 'primary', { error: 'connect ECONNREFUSED' })])
    expect(d.allow).toBe(false)
    expect(d.reason).toMatch(/could not verify/i)
    expect(d.reason).toContain('ECONNREFUSED')
  })
  test('no checks at all denies (nothing proved the recipient)', () => {
    expect(decidePayment([]).allow).toBe(false)
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @bound/core exec vitest run test/mpp.test.ts`
Expected: FAIL — `Cannot find module '../src/mpp'`.

- [ ] **Step 3: Implement**

```ts
// packages/core/src/mpp.ts
import { getAddress, isAddress, type Address } from 'viem'
import type { Action } from './policy'
import type { Verdict } from './verdict'

export type PaymentRecipient = { address: Address; role: 'primary' | 'split'; amount: string }
export type ChallengeLike = { method: string; intent: string; request: Record<string, unknown> }
export type Inspection =
  | { ok: true; free: boolean; chainId: number | null; recipients: PaymentRecipient[] }
  | { ok: false; reason: string }

const SUPPORTED_INTENTS = new Set(['charge', 'session'])

/** Reads who an MPP payment request would pay. Anything it cannot read with certainty is refused (fail closed). */
export function inspectChallenge(c: ChallengeLike, opts: { expectedChainId?: number } = {}): Inspection {
  if (c.method !== 'tempo') return { ok: false, reason: `unsupported payment method "${c.method}" (only tempo is checked)` }
  if (!SUPPORTED_INTENTS.has(c.intent)) return { ok: false, reason: `unsupported payment intent "${c.intent}" (only charge and session are checked)` }
  const req = c.request ?? {}
  const details = (req.methodDetails ?? {}) as { chainId?: unknown; splits?: unknown }
  const chainId = typeof details.chainId === 'number' ? details.chainId : null
  if (opts.expectedChainId !== undefined && chainId !== null && chainId !== opts.expectedChainId) {
    return { ok: false, reason: `payment request is for chain ${chainId}, expected ${opts.expectedChainId}` }
  }
  const amount = String(req.amount ?? '')
  if (amount === '0') return { ok: true, free: true, chainId, recipients: [] }
  if (typeof req.recipient !== 'string' || !isAddress(req.recipient)) {
    return { ok: false, reason: 'payment request has no valid recipient to verify' }
  }
  const recipients: PaymentRecipient[] = [{ address: getAddress(req.recipient), role: 'primary', amount }]
  if (details.splits !== undefined) {
    if (!Array.isArray(details.splits)) return { ok: false, reason: 'payment request has malformed splits' }
    for (const s of details.splits as { recipient?: unknown; amount?: unknown }[]) {
      if (typeof s?.recipient !== 'string' || !isAddress(s.recipient)) return { ok: false, reason: 'payment request has a split with an invalid recipient' }
      recipients.push({ address: getAddress(s.recipient), role: 'split', amount: String(s.amount ?? '') })
    }
  }
  return { ok: true, free: false, chainId, recipients }
}

export type RecipientCheck = {
  recipient: PaymentRecipient
  verdict: Verdict | null
  action: Action | null
  payee: { legalName: string; domain: string } | null
  allowed: boolean
  error?: string
}
export type GuardDecision = { allow: boolean; reason: string; checks: RecipientCheck[] }

const HARD_NO = new Set<Verdict>(['LOOKALIKE', 'CHANGED', 'REVOKED'])

/**
 * One decision over every recipient of a payment. The verdict decides, not the action: a check made without an org can
 * never produce PAY. LOOKALIKE, CHANGED and REVOKED always deny; CLOSE_MATCH and NO_MATCH follow onAsk (default block).
 */
export function decidePayment(checks: RecipientCheck[], opts: { onAsk?: 'block' | 'allow' } = {}): GuardDecision {
  if (checks.length === 0) return { allow: false, reason: 'nothing verified the recipient', checks }
  for (const c of checks) {
    const who = `${c.recipient.role === 'primary' ? 'recipient' : 'split recipient'} ${c.recipient.address}`
    if (c.allowed) continue
    if (c.error !== undefined || c.verdict === null) return { allow: false, reason: `could not verify ${who}: ${c.error ?? 'no verdict'}`, checks }
    if (HARD_NO.has(c.verdict)) return { allow: false, reason: `${who} is a ${c.verdict} wallet, not the verified one`, checks }
    if (c.verdict !== 'MATCH' && opts.onAsk !== 'allow') return { allow: false, reason: `${who} is not verified (${c.verdict})`, checks }
  }
  return { allow: true, reason: 'every recipient is verified', checks }
}
```

- [ ] **Step 4: Export it and run the tests**

Add `export * from './mpp'` to `packages/core/src/index.ts`.
Run: `pnpm --filter @bound/core test`
Expected: all pass (159 existing plus the new ones). Then `pnpm --filter @bound/core typecheck`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/mpp.ts packages/core/test/mpp.test.ts packages/core/src/index.ts
git commit -m "feat(core): inspect MPP payment requests and decide whether every recipient is verified"
```

---

### Task 3: SDK — `createGuardedFetch`

**Files:**
- Create: `packages/sdk/src/guard.ts`
- Create: `packages/sdk/test/guard.test.ts`
- Modify: `packages/sdk/src/index.ts` (add `verifyService` to `BoundClient`; `export * from './guard'`)

**Interfaces:**
- Consumes: Task 2's `inspectChallenge`, `decidePayment`, `GuardDecision`, `RecipientCheck`, `ChallengeLike` from `@bound/core`.
- Produces:

```ts
// BoundClient gets:
verifyService(i: { address: string; domain?: string }): Promise<VerifyResponse>   // POST /v1/verify-service
// guard.ts:
export type PreparedPaymentLike = { challenge: ChallengeLike; createCredential: () => Promise<string>; setCredential: (request: RequestInit, credential: string) => RequestInit }
export type MppxLike = { rawFetch(input: string, init?: RequestInit): Promise<Response>; preparePayment(response: Response, opts?: { request?: RequestInit }): Promise<PreparedPaymentLike> }
export type GuardOptions = {
  bound: { verifyService(i: { address: string; domain?: string }): Promise<VerifyResponse> }
  mppx: MppxLike
  serviceDomain?: string            // default: the URL's hostname
  allowRecipients?: string[]        // addresses accepted without a Bound check (case-insensitive)
  onAsk?: 'block' | 'allow'
  expectedChainId?: number
  onDecision?: (d: GuardDecision & { url: string }) => void
}
export class PaymentBlockedError extends Error { constructor(readonly decision: GuardDecision & { url: string }) }
export function createGuardedFetch(o: GuardOptions): (input: string | URL, init?: RequestInit) => Promise<Response>
```

- [ ] **Step 1: Write the failing tests**

```ts
// packages/sdk/test/guard.test.ts
import { describe, expect, test, vi } from 'vitest'
import { createGuardedFetch, PaymentBlockedError, type MppxLike } from '../src/guard'

const SERVICE = '0xc1a53DA961B7A3A62db84Ae889f57fa818d3C426'
const LOOKALIKE = '0xC1A5d69D86Dea5CA36F7aE391b6610CfFB96C426'
const verdictFor = (address: string, domain?: string) => {
  const ok = address.toLowerCase() === SERVICE.toLowerCase()
  return { verdict: ok ? 'MATCH' : 'LOOKALIKE', action: ok ? 'ASK' : 'BLOCK', payee: ok ? { legalName: 'Acme Ltd', domain: 'acme.example' } : null, reasons: [], domainSeen: domain } as any
}

function setup(request: Record<string, unknown>, o: { verify?: (i: any) => Promise<any>; method?: string; intent?: string } = {}) {
  const calls: string[] = []
  const createCredential = vi.fn(async () => 'cred')
  const mppx: MppxLike = {
    rawFetch: vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push(init?.headers && (init.headers as any).authorization ? 'paid' : 'first')
      return (init?.headers as any)?.authorization ? new Response('data', { status: 200 }) : new Response('pay', { status: 402 })
    }),
    preparePayment: vi.fn(async () => ({
      challenge: { method: o.method ?? 'tempo', intent: o.intent ?? 'charge', request },
      createCredential,
      setCredential: (init: RequestInit, c: string) => ({ ...init, headers: { ...(init.headers as object), authorization: c } }),
    })),
  }
  const bound = { verifyService: vi.fn(o.verify ?? (async (i: any) => verdictFor(i.address, i.domain))) }
  const decisions: any[] = []
  const guarded = createGuardedFetch({ bound, mppx, serviceDomain: 'acme.example', onDecision: (d) => decisions.push(d) })
  return { guarded, bound, mppx, createCredential, calls, decisions }
}

describe('createGuardedFetch', () => {
  test('a response that is not 402 passes straight through', async () => {
    const { guarded, mppx } = setup({ amount: '1', recipient: SERVICE })
    ;(mppx.rawFetch as any).mockResolvedValueOnce(new Response('free', { status: 200 }))
    expect((await guarded('https://api.example/x')).status).toBe(200)
    expect(mppx.preparePayment).not.toHaveBeenCalled()
  })
  test('pays when the recipient is the verified wallet for the service domain', async () => {
    const { guarded, bound, createCredential, calls } = setup({ amount: '10000', recipient: SERVICE.toLowerCase() })
    const res = await guarded('https://api.example/data')
    expect(res.status).toBe(200)
    expect(bound.verifyService).toHaveBeenCalledWith({ address: SERVICE, domain: 'acme.example' })
    expect(createCredential).toHaveBeenCalledTimes(1)
    expect(calls).toEqual(['first', 'paid'])
  })
  test('uses the URL host when no serviceDomain is given', async () => {
    const { mppx, bound } = setup({ amount: '1', recipient: SERVICE })
    const guarded = createGuardedFetch({ bound, mppx })
    await guarded('https://data.acme.example/v1/quote')
    expect(bound.verifyService).toHaveBeenCalledWith({ address: SERVICE, domain: 'data.acme.example' })
  })
  test('a hijacked recipient is blocked before anything is signed (review focus 6)', async () => {
    const { guarded, createCredential, calls, decisions } = setup({ amount: '10000', recipient: LOOKALIKE })
    await expect(guarded('https://api.example/data')).rejects.toBeInstanceOf(PaymentBlockedError)
    expect(createCredential).not.toHaveBeenCalled()
    expect(calls).toEqual(['first'])
    expect(decisions[0]).toMatchObject({ allow: false, url: 'https://api.example/data' })
  })
  test('the error carries the decision and a readable message', async () => {
    const { guarded } = setup({ amount: '1', recipient: LOOKALIKE })
    const err: PaymentBlockedError = await guarded('https://api.example/d').catch((e) => e)
    expect(err.message).toMatch(/blocked/i)
    expect(err.message).toMatch(/LOOKALIKE/)
    expect(err.decision.checks[0].verdict).toBe('LOOKALIKE')
  })
  test('a verified primary with an unverified split is blocked (review focus 1)', async () => {
    const { guarded, createCredential } = setup({ amount: '10000', recipient: SERVICE, methodDetails: { splits: [{ recipient: LOOKALIKE, amount: '500' }] } })
    await expect(guarded('https://api.example/d')).rejects.toBeInstanceOf(PaymentBlockedError)
    expect(createCredential).not.toHaveBeenCalled()
  })
  test('a split is checked without a domain; allowRecipients skips the check (case-insensitive)', async () => {
    const { mppx, bound } = setup({ amount: '10000', recipient: SERVICE, methodDetails: { splits: [{ recipient: LOOKALIKE, amount: '500' }] } })
    const guarded = createGuardedFetch({ bound, mppx, serviceDomain: 'acme.example', allowRecipients: [LOOKALIKE.toLowerCase()] })
    expect((await guarded('https://api.example/d')).status).toBe(200)
    expect(bound.verifyService).toHaveBeenCalledTimes(1) // only the primary
  })
  test('a failing Bound API blocks, never pays (review focus 3)', async () => {
    const { guarded, createCredential } = setup({ amount: '1', recipient: SERVICE }, { verify: async () => { throw new Error('ECONNREFUSED') } })
    const err: PaymentBlockedError = await guarded('https://api.example/d').catch((e) => e)
    expect(err).toBeInstanceOf(PaymentBlockedError)
    expect(err.decision.reason).toMatch(/could not verify/i)
    expect(createCredential).not.toHaveBeenCalled()
  })
  test('unsupported methods and intents are blocked (review focus 4)', async () => {
    for (const o of [{ method: 'stripe' }, { intent: 'subscription' }]) {
      const { guarded, createCredential } = setup({ amount: '1', recipient: SERVICE }, o)
      await expect(guarded('https://api.example/d')).rejects.toBeInstanceOf(PaymentBlockedError)
      expect(createCredential).not.toHaveBeenCalled()
    }
  })
  test('a free identity challenge (amount 0) signs without any Bound call', async () => {
    const { guarded, bound, createCredential } = setup({ amount: '0', recipient: SERVICE })
    expect((await guarded('https://api.example/d')).status).toBe(200)
    expect(bound.verifyService).not.toHaveBeenCalled()
    expect(createCredential).toHaveBeenCalledTimes(1)
  })
  test('a chain mismatch is blocked', async () => {
    const { mppx, bound, createCredential } = setup({ amount: '1', recipient: SERVICE, methodDetails: { chainId: 4217 } })
    const guarded = createGuardedFetch({ bound, mppx, serviceDomain: 'acme.example', expectedChainId: 42431 })
    await expect(guarded('https://api.example/d')).rejects.toBeInstanceOf(PaymentBlockedError)
    expect(createCredential).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @bound/sdk exec vitest run test/guard.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `guard.ts` and `verifyService`**

```ts
// packages/sdk/src/guard.ts
import { decidePayment, inspectChallenge, type ChallengeLike, type GuardDecision, type RecipientCheck } from '@bound/core'
import type { VerifyResponse } from './index'

export type PreparedPaymentLike = {
  challenge: ChallengeLike
  createCredential: () => Promise<string>
  setCredential: (request: RequestInit, credential: string) => RequestInit
}
/** The two members of an `mppx` client the guard needs; create it with `polyfill: false` so the guard owns the 402 flow. */
export type MppxLike = {
  rawFetch(input: string, init?: RequestInit): Promise<Response>
  preparePayment(response: Response, opts?: { request?: RequestInit }): Promise<PreparedPaymentLike>
}
export type GuardOptions = {
  bound: { verifyService(i: { address: string; domain?: string }): Promise<VerifyResponse> }
  mppx: MppxLike
  /** The service the agent means to pay. Caller configuration, never read from the API's own response. Default: the URL's hostname. */
  serviceDomain?: string
  /** Addresses accepted without a Bound check (e.g. a platform-fee split you trust). Case-insensitive. */
  allowRecipients?: string[]
  onAsk?: 'block' | 'allow'
  expectedChainId?: number
  onDecision?: (d: GuardDecision & { url: string }) => void
}

export class PaymentBlockedError extends Error {
  constructor(readonly decision: GuardDecision & { url: string }) {
    super(`Payment blocked before signing: ${decision.reason}`)
    this.name = 'PaymentBlockedError'
  }
}

/** A fetch that, on an MPP 402, verifies every recipient with Bound before it signs anything. Denials throw PaymentBlockedError. */
export function createGuardedFetch(o: GuardOptions): (input: string | URL, init?: RequestInit) => Promise<Response> {
  const allow = new Set((o.allowRecipients ?? []).map((a) => a.toLowerCase()))
  return async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.toString()
    const first = await o.mppx.rawFetch(url, init)
    if (first.status !== 402) return first
    const payment = await o.mppx.preparePayment(first, { request: init })
    const inspected = inspectChallenge(payment.challenge, { expectedChainId: o.expectedChainId })
    let decision: GuardDecision
    if (!inspected.ok) decision = { allow: false, reason: inspected.reason, checks: [] }
    else if (inspected.free) decision = { allow: true, reason: 'no money moves (identity proof)', checks: [] }
    else {
      const domain = o.serviceDomain ?? new URL(url).hostname
      const checks: RecipientCheck[] = []
      for (const recipient of inspected.recipients) {
        if (allow.has(recipient.address.toLowerCase())) {
          checks.push({ recipient, verdict: null, action: null, payee: null, allowed: true })
          continue
        }
        try {
          const r = await o.bound.verifyService({ address: recipient.address, domain: recipient.role === 'primary' ? domain : undefined })
          checks.push({ recipient, verdict: r.verdict, action: r.action, payee: r.payee ? { legalName: r.payee.legalName, domain: r.payee.domain } : null, allowed: false })
        } catch (e) {
          checks.push({ recipient, verdict: null, action: null, payee: null, allowed: false, error: (e as Error)?.message ?? String(e) })
        }
      }
      decision = decidePayment(checks, { onAsk: o.onAsk })
    }
    const full = { ...decision, url }
    o.onDecision?.(full)
    if (!decision.allow) throw new PaymentBlockedError(full)
    const credential = await payment.createCredential()
    return o.mppx.rawFetch(url, payment.setCredential(init, credential))
  }
}
```

In `packages/sdk/src/index.ts` add `export * from './guard'` and, inside `BoundClient`:

```ts
  /** Is this wallet the verified one for `domain`? Without a domain: is it an active Bound-verified wallet at all? */
  verifyService(i: { address: string; domain?: string }) {
    return this.req<VerifyResponse>('/v1/verify-service', { method: 'POST', body: JSON.stringify(i) })
  }
```

(`guard.ts` imports a type from `./index` and `index.ts` re-exports `guard.ts`; both are type-only edges at runtime, so there is no cycle problem. If the type import causes a cycle error in the build, move `VerifyResponse` into `packages/sdk/src/types.ts` and import it from both.)

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @bound/sdk test && pnpm --filter @bound/sdk typecheck`
Expected: all pass (4 existing plus the new ones).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk
git commit -m "feat(sdk): createGuardedFetch verifies every MPP recipient with Bound before signing"
```

---

### Task 4: Server — `verify-service` endpoint and MCP tool

**Files:**
- Modify: `apps/server/src/services/verify-service.ts` (add `verifyService`)
- Modify: `apps/server/src/routes/verify.ts` (add `POST /verify-service`)
- Modify: `apps/server/src/mcp.ts` (add `verify_payment_request`)
- Create: `apps/server/test/verify-service.test.ts`, `apps/server/test/mcp-payment.test.ts`

**Interfaces:**
- Consumes: `verifyPayee` (same file), `normalizeDomain`, `inspectChallenge`, `decidePayment` from `@bound/core`; existing test helpers in `apps/server/test/verify.test.ts` and `apps/server/test/mcp.test.ts` (read them first and copy their setup: how `deps`, the `payees` mirror rows and a fake `ops` (`resolveRecipient`, `readPayee`) are built).
- Produces: `verifyService(deps: ServiceDeps, input: { address: Address; domain?: string }): Promise<VerifyOutput>`; `POST /v1/verify-service` `{ address, domain? }` → `VerifyOutput`; MCP tool `verify_payment_request` `{ recipient, domain?, splits?: string[] }` → `{ allow, reason, checks[] }` (the `GuardDecision` JSON).

- [ ] **Step 1: Write the failing tests** in `apps/server/test/verify-service.test.ts`, using the same setup as `verify.test.ts`, with a mirror containing one active payee `Acme Ltd`, `acme.example`, wallet `0xc1a5…C426`:

  1. `verifyService({ address: ACME, domain: 'acme.example' })` → verdict `MATCH`.
  2. Same wallet with `domain: 'data.acme.example'` (a subdomain) → `MATCH`.
  3. `verifyService({ address: LOOKALIKE, domain: 'acme.example' })` (the 4+4 lookalike, unregistered) → verdict `LOOKALIKE` and action `BLOCK`.
  4. `verifyService({ address: ACME, domain: 'acme-ltd.co' })` (a lookalike domain claiming nothing registered) → verdict is not `MATCH`.
  5. `verifyService({ address: ACME })` (no domain) → `MATCH` (an active Bound-verified wallet); `verifyService({ address: UNREGISTERED })` → `NO_MATCH`.
  6. A revoked or superseded payee is not matched by domain: add a revoked row for `old.example` and assert its wallet is not `MATCH`.
  7. HTTP: `POST /v1/verify-service` with a bad address → 400; with a 300-char domain → 400; valid → 200 with `verdict`.

- [ ] **Step 2: Run to see them fail** — `pnpm --filter @bound/server exec vitest run test/verify-service.test.ts` → FAIL (`verifyService` not exported / 404).

- [ ] **Step 3: Implement** in `verify-service.ts`:

```ts
/**
 * Confirmation of Payee for a SERVICE: is `address` the wallet Bound has verified for `domain`? The claimed payee is the active
 * registry record whose domain is `domain` (or a parent of it); without a domain it is the record owning the wallet itself, so the
 * answer is "is this an active Bound-verified wallet". Never org-scoped (no pins, no allowlist).
 */
export async function verifyService(deps: ServiceDeps, input: { address: Address; domain?: string }): Promise<VerifyOutput> {
  const address = getAddress(input.address)
  const domain = input.domain ? normalizeDomain(input.domain) : undefined
  const active = deps.db.select().from(payees).all().filter((p) => !p.revokedAt && !p.supersededAt)
  let claim: PayeeRow | undefined
  if (domain) claim = active.find((p) => { const d = normalizeDomain(p.domain); return domain === d || domain.endsWith(`.${d}`) })
  else {
    const r = await deps.ops.resolveRecipient(address)
    claim = active.find((p) => same(p.wallet, r.effective))
  }
  return verifyPayee(deps, { address, payeeName: claim?.legalName ?? domain ?? address, senderDomain: domain ?? claim?.domain })
}
```

In `routes/verify.ts` add (reusing `limit`):

```ts
const serviceBody = z.object({
  address: z.string().refine((a) => isAddress(a), 'Invalid address'),
  domain: z.string().trim().min(1).max(253).optional(),
})
  r.post('/verify-service', limit, async (req, res) => {
    const b = serviceBody.parse(req.body)
    res.json(await verifyService(deps, { address: getAddress(b.address), domain: b.domain }))
  })
```

If `normalizeDomain` throws on a malformed domain, catch it and throw `new HttpError(400, 'Invalid domain')`.

- [ ] **Step 4: MCP tool.** Write `apps/server/test/mcp-payment.test.ts` first (copy the client setup from `mcp.test.ts`): `verify_payment_request` with `{ recipient: ACME, domain: 'acme.example' }` → `allow: true`; with `{ recipient: LOOKALIKE, domain: 'acme.example' }` → `allow: false` and a reason containing `LOOKALIKE`; with `splits: [LOOKALIKE]` and a verified primary → `allow: false`; a thrown verification error → `isError` with the existing "treat as unverified" wording; an invalid address → `isError`. Then register the tool next to `verify_payee`:

```ts
  server.registerTool('verify_payment_request', {
    description: 'Before an AI agent pays an MPP (HTTP 402) request: is the recipient the verified wallet of the service it means to pay? Pass the 402 challenge\'s recipient, the service domain, and any split recipients. Returns allow true/false with the reason; never pay when allow is false.',
    inputSchema: {
      recipient: z.string().max(100).describe('The challenge\'s primary recipient address (0x…)'),
      domain: z.string().max(253).optional().describe('The service domain the agent means to pay, e.g. api.acme.com'),
      splits: z.array(z.string().max(100)).max(10).optional().describe('Split recipient addresses from the challenge, if any'),
    },
    annotations: READ_ONLY,
  }, async ({ recipient, domain, splits }) => {
    const all = [recipient, ...(splits ?? [])]
    if (!all.every((a) => isAddress(a.trim()))) return toolError('invalid address')
    try {
      const checks: RecipientCheck[] = []
      for (const [i, raw] of all.entries()) {
        const address = getAddress(raw.trim())
        const r = await verifyService(deps, { address, domain: i === 0 ? domain || undefined : undefined })
        checks.push({ recipient: { address, role: i === 0 ? 'primary' : 'split', amount: '' }, verdict: r.verdict, action: r.action, payee: r.payee ? { legalName: r.payee.legalName, domain: r.payee.domain } : null, allowed: false })
      }
      return json(decidePayment(checks))
    } catch (e) {
      console.error('[mcp] verify_payment_request failed', e)
      return toolError('verification unavailable; do not pay this request')
    }
  })
```

- [ ] **Step 5: Run everything**: `pnpm --filter @bound/server test && pnpm --filter @bound/server typecheck`. Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/server
git commit -m "feat(server): verify-service endpoint and the verify_payment_request MCP tool"
```

---

### Task 5: Server — demo paid API and the public demo run

**Read first:** `docs/superpowers/notes/2026-10-07-mpp-spike.md` (Task 1). It fixes the exact `mppx/express` server snippet, the signing mode, and what a rejected payment looks like. Where this task says "per the spike", use that note, not a guess.

**Files:**
- Create: `apps/server/src/routes/demo-api.ts`
- Modify: `apps/server/src/db/schema.ts`, `apps/server/src/db/client.ts` (table `demo_api_runs`)
- Modify: `apps/server/src/index.ts` (mount next to `mountDemo`)
- Modify: `apps/server/src/config.ts` (`MPP_SECRET_KEY`, optional; see below)
- Create: `apps/server/test/demo-api.test.ts`

**Interfaces:**
- Consumes: `mountDemo`'s gating rules in `apps/server/src/routes/demo.ts` (testnet or `LAB_ENABLED`, never mainnet; `DEMO_PUBLIC_ORG_ID` set, authorized, not equal to `DEMO_ORG_ID`; per-IP limits via `perIpLimit`), the public demo org's decrypted agent key as `payWithKey`/the lab path obtains it (read `apps/server/src/services/payments.ts` and `apps/server/src/agent/tools.ts` `rawTransfer` to see how an org's agent account is built), `createGuardedFetch` from `@bound/sdk`, `forceSendWithKey` from `@bound/core` (for the evidence transaction, testnet only), `agentBudget` is **not** used (no model tokens).
- Produces:
  - `GET /v1/demo/api/data[?hijack=1]` — the demo paid API: `mppx.charge({ amount: '0.01', currency: PATHUSD, recipient: hijack ? LAB_LOOKALIKE : DEMO_PAYEE })`, answers `{ data: 'Q4 supplier price index: 1.07' }` after payment. Mounted only under the demo gating rules.
  - `POST /v1/demo/api-runs` body `{ hijacked: boolean, guardOff: boolean }` → `200` with the whole run synchronously:

```ts
type ApiRunStep = { kind: 'request' | 'challenge' | 'check' | 'decision' | 'sign' | 'result'; text: string; data?: unknown }
type ApiRunResult = {
  steps: ApiRunStep[]
  outcome: 'paid' | 'blocked_by_bound' | 'blocked_by_tempo' | 'failed'
  recipient: string
  txHash: string | null
  txUrl: string | null
  message: string          // one plain sentence for the page
}
```

  - `GET /v1/demo/api-runs/status` → `{ status: 'ready' | 'unavailable' | 'busy', message: string | null, runsPerHour: number }` (same semantics as `GET /v1/demo`).
  - Environment: `DEMO_API_RUNS_PER_DAY` (default 200, 0 pauses) counted from `demo_api_runs`; per-IP limit reuses `DEMO_RUNS_PER_IP_HOUR`.

- [ ] **Step 1: Table.** Add to `schema.ts` and the `CREATE TABLE IF NOT EXISTS` list in `client.ts`:

```ts
export const demoApiRuns = sqliteTable('demo_api_runs', {
  id: text('id').primaryKey(),                      // dar_<random>
  hijacked: integer('hijacked').notNull(),
  guardOff: integer('guard_off').notNull(),
  outcome: text('outcome').notNull(),
  txHash: text('tx_hash'),
  createdAt: integer('created_at').notNull(),
})
// CREATE TABLE IF NOT EXISTS demo_api_runs (id TEXT PRIMARY KEY, hijacked INTEGER NOT NULL, guard_off INTEGER NOT NULL, outcome TEXT NOT NULL, tx_hash TEXT, created_at INTEGER NOT NULL);
// CREATE INDEX IF NOT EXISTS demo_api_runs_created ON demo_api_runs (created_at);
```

- [ ] **Step 2: Write the failing tests** (`demo-api.test.ts`, same style as `demo.test.ts`: build `deps` with `config.network`, `demoOrgId`, `demoPublicOrgId`, an in-memory db with the public org authorized, a fake `ops`/chain, and inject the paid-API handler and the payment client as parameters of `demoApiRouter(deps, { fetchImpl, pay })` so no real network or chain is touched):
  1. Not mounted on mainnet, even with `labEnabled` (like `mountDemo`); returns `false` when the public org is unset or equal to the filmed one.
  2. `status` → `unavailable` when `DEMO_PUBLIC_ORG_ID` is unset; `busy` at the daily cap (insert `demo_api_runs` rows); `ready` otherwise.
  3. Honest API + guard on → `outcome: 'paid'`, steps include `challenge`, `check` (verdict MATCH), `decision` (allow), `sign`, `result`.
  4. Hijacked + guard on → `outcome: 'blocked_by_bound'`, **no `sign` step**, and the injected `pay` was never called.
  5. Hijacked + guard off → the payment is attempted and the injected `pay` throws a `CallNotAllowed`-style error → `outcome: 'blocked_by_tempo'`, message mentions Tempo, `txHash` set when the injected evidence sender returns one.
  6. Body validation: non-boolean fields → 400. Per-IP limit → 429 after `DEMO_RUNS_PER_IP_HOUR` runs. Daily cap → 429 with the busy message.
  7. A run that throws unexpectedly → `outcome: 'failed'` with a generic message (no stack, no key material in the response); the row is still recorded.

- [ ] **Step 3: Implement `demo-api.ts`.** Structure (use the spike note for the mppx specifics):

```ts
export function demoApiRouter(deps: ServiceDeps, inject: { fetchImpl?: typeof fetch; pay?: PayFn; sendEvidence?: EvidenceFn } = {}) { /* Router with the three routes above */ }
export function mountDemoApi(app: Express, deps: ServiceDeps, inject?: ...): boolean { /* same gating as mountDemo */ }
```

The run, in order, recording a step each time:
  1. `request`: "Agent asks for the supplier price index" (`GET <selfUrl>/v1/demo/api/data[?hijack=1]`, where `selfUrl` is `http://127.0.0.1:${config.port}`).
  2. Build the payment client with the public demo org's agent account: `Mppx.create({ methods: [tempo({ account, mode: <per spike>, expectedChainId: 42431 })], polyfill: false })`.
  3. Guard **on** → `createGuardedFetch({ bound: <in-process BoundClient shim calling verifyService directly>, mppx, serviceDomain: 'acme.example', expectedChainId: 42431, onDecision })`. The shim implements `{ verifyService }` by calling `verifyService(deps, …)` in-process (no HTTP round trip). A `PaymentBlockedError` → `outcome: 'blocked_by_bound'`.
  4. Guard **off** → call `mppx.fetch(url)` directly. If Tempo rejects (per the spike's recorded error shape, detect `CallNotAllowed` by selector `0x576b38b4` or name), `outcome: 'blocked_by_tempo'`. Then, to give the page a mined reverted transaction to link, call `sendEvidence` (default: `forceSendWithKey` from `@bound/core` with the same recipient and 0.01 pathUSD, **testnet only**, bounded wait) and record `txHash`/`txUrl`; if it fails, the run still reports `blocked_by_tempo` without a link.
  5. A 200 with data → `outcome: 'paid'`, `txHash` from the receipt if present.

Every step's `text` is a plain sentence a non-expert can read; `data` carries addresses and the verdict. Nothing secret (keys, org token) ever enters `steps`.

- [ ] **Step 4: Mount it** in `apps/server/src/index.ts` immediately after `mountDemo(app, deps)`; the demo API route (`/v1/demo/api/data`) is mounted by the same call. Add `MPP_SECRET_KEY` to `config.ts` as optional (mppx auto-detects it from the environment; when unset, derive a stable 32-byte secret from `SERVER_SECRET` via `keccak256` so a fresh deploy works with no new setting) and document it in `.env.example`.

- [ ] **Step 5: Run** `pnpm --filter @bound/server test && pnpm --filter @bound/server typecheck` — all pass.

- [ ] **Step 6: One live check on testnet** (the only network step in this task): restart the local server, then
  `curl -s -X POST localhost:8787/v1/demo/api-runs -H 'content-type: application/json' -d '{"hijacked":false,"guardOff":false}'` → `outcome: "paid"`;
  `{"hijacked":true,"guardOff":false}` → `blocked_by_bound`; `{"hijacked":true,"guardOff":true}` → `blocked_by_tempo`. Paste the three `outcome` lines into the commit body. The public demo org's allowlist must contain the honest Acme wallet for the first call to pay: add it once with the existing approval flow or `scripts/` helper the spike used, and record how in the README (Task 8).

- [ ] **Step 7: Commit**

```bash
git add apps/server
git commit -m "feat(server): demo paid API and a public run: guard on or off, API honest or hijacked"
```

---

### Task 6: Web — the paid-API scenario on `/try`

**Files:**
- Modify: `apps/web/app/try/TryDemo.tsx` (scenario switch), `apps/web/app/try/page.tsx` if copy lives there
- Create: `apps/web/components/ApiRun.tsx` (the result card for an API run)
- Modify: `apps/web/lib/presets.ts` only if shared copy is needed; do not touch the invoice presets.

**Interfaces:**
- Consumes: Task 5's `POST /v1/demo/api-runs`, `GET /v1/demo/api-runs/status`, the `ApiRunResult` type (copy the type into `apps/web/lib/api.ts` types; the web app does not import server code); existing `api`, `ApiError`, `BlockedStamp`, `Pill`, `card`, `primaryBtn`, `pageTitle`, the switch component used for "Bound software" in `components/LabRun.tsx` (reuse it, do not rebuild).
- Produces: on `/try`, a two-way scenario control **"Pay an invoice" / "Buy data from a paid API"** (default: invoices; remember nothing). The API scenario shows two switches, **"API is hijacked"** (off by default) and **"Bound software"** (on by default), a **"Buy the data"** button, and a result card.

- [ ] **Step 1: Scenario control and form.** Keep the existing invoice scenario untouched behind the control. For the API scenario the left card explains in one sentence ("An agent buys a price index from a paid API. Switch on the hijack and the API names a scammer's wallet.") and holds the two switches and the button. Disable the button while running; show the calm offline/busy/rate-limited notices exactly like the invoice scenario (reuse `noticeFor`).
- [ ] **Step 2: Result card (`ApiRun.tsx`).** A vertical step list (icon, one plain sentence each, mono details for addresses), then a verdict block by outcome:
  - `paid`: green "Paid" pill, "0.01 pathUSD to Acme Ltd (verified)", explorer link if `txUrl`.
  - `blocked_by_bound`: `BlockedStamp verb="Blocked" note="Bound read the payment request and stopped before signing."` with "$0 moved".
  - `blocked_by_tempo`: `BlockedStamp` default copy ("Our software was off. Tempo still said no.") and "View the reverted transaction ↗" when `txUrl`.
  - `failed`: calm grey "The demo hit a problem. Try again."
  Scroll the result into view on phones after Run (same `matchMedia('(max-width: 1023px)')` + `scrollIntoView` pattern as the invoice scenario).
- [ ] **Step 3: Verify in a browser.** `pnpm --filter @bound/web lint`, `pnpm --filter @bound/web exec tsc --noEmit`. Then, using Playwright with `page.route` fixtures for the three outcomes (and `localStorage['bound.tour.v1']='1'` via `addInitScript` so the welcome tour does not cover the page), screenshot idle, paid, blocked-by-Bound and blocked-by-Tempo at 1440 and 390 into the scratchpad `shots-api/` folder; look at each. No horizontal overflow, no console errors. Then one live run against the local API for each of the three switch combinations.
- [ ] **Step 4: Commit**

```bash
git add apps/web
git commit -m "feat(web): /try gets a paid-API scenario: hijack the API, switch Bound on or off"
```

---

### Task 7: Rehearsal, docs and wrap-up

**Files:**
- Modify: `apps/server/scripts/rehearse.ts` (scenarios 6–8), `README.md`, `.env.example`
- Create: `packages/sdk/README.md` (usage of `createGuardedFetch` and `verifyService`)

- [ ] **Step 1: Rehearsal.** Extend `rehearse.ts` after scenario 5 with: **6. Paid API, honest** (guard on → `paid`), **7. Paid API, hijacked** (guard on → `blocked_by_bound`, `sign` absent), **8. Paid API, hijacked, Bound off** (→ `blocked_by_tempo`, explorer link when present), each through `POST /v1/demo/api-runs` and printed in the summary table. Keep the script testnet-only (`requireTestnet`, `assertTestnetChain`); scenarios 6–8 are skipped with a clear message when `DEMO_PUBLIC_ORG_ID` is unset.
- [ ] **Step 2: Docs.** README: a section "Guarding MPP payments" (the 30-second version, the SDK snippet below, the MCP tool, the demo endpoints, `DEMO_API_RUNS_PER_DAY`, `MPP_SECRET_KEY`, how the public demo org's allowlist gets the Acme wallet). SDK README: install note (workspace for now), and the snippet:

```ts
import { Mppx, tempo } from 'mppx/client'
import { BoundClient, createGuardedFetch } from '@bound/sdk'

const mppx = Mppx.create({ methods: [tempo({ account })], polyfill: false })
const guardedFetch = createGuardedFetch({
  bound: new BoundClient({ baseUrl: 'https://bound.example' }),
  mppx,
  serviceDomain: 'api.acme.com',      // the service you mean to pay
  expectedChainId: 42431,
})
const res = await guardedFetch('https://api.acme.com/quote') // throws PaymentBlockedError before signing if the recipient isn't Acme's verified wallet
```

- [ ] **Step 3: Full verification.** `pnpm -r test`, `pnpm -r typecheck`, `pnpm --filter @bound/web lint`, `pnpm --filter @bound/web build` **in a worktree** (never `next build` in the main checkout while `next dev` runs). Run `TEMPO_NETWORK=testnet pnpm --filter @bound/server demo:rehearse` against the running local server: all eight scenarios pass.
- [ ] **Step 4: Commit**

```bash
git add apps/server/scripts/rehearse.ts README.md .env.example packages/sdk/README.md
git commit -m "docs(server): rehearsal scenarios 6-8 and a guide to guarding MPP payments"
```

---

## Self-Review

- **Spec coverage:** guard logic → Task 2; SDK → Task 3; service endpoint + MCP tool → Task 4; demo API + public run + caps → Task 5; `/try` scenario → Task 6; rehearsal + docs → Task 7; the unknowns about `mppx` signing → Task 1. Success criteria 1–4 map to Tasks 3, 3, 5, 6/7.
- **Placeholder scan:** Tasks 1 and 5 intentionally defer exact `mppx` option names to the installed type definitions and the Task 1 notes file, because they cannot be known without running the SDK; everything else carries concrete code or exact test cases.
- **Type consistency:** `PaymentRecipient`, `RecipientCheck`, `GuardDecision`, `inspectChallenge`, `decidePayment` (Task 2) are the names Tasks 3 and 4 import; `verifyService` is the server function (Task 4) and the `BoundClient` method (Task 3) with the same `{ address, domain? }` input; `ApiRunResult` (Task 5) is what Task 6 renders.
- **Review focus:** each of the six lines has a named test (Tasks 2–3), including the deny path never calling `createCredential`.
