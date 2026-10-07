# Bound

> **Your AI agent can't pay a stranger.**
> Confirmation of Payee for stablecoin payments, enforced by Tempo.

Companies are handing accounts payable to AI agents, and stablecoin payments are final. The two oldest payment frauds, the "we changed our bank details" invoice and the lookalike address, now meet an agent that pays in under a second and can be prompt-injected. Bound checks who controls a payment address before money moves: payees prove their domain and wallet once in an onchain registry, and every invoice gets a verdict (MATCH, CLOSE_MATCH, NO_MATCH, LOOKALIKE, CHANGED, REVOKED). On Tempo it goes further than a warning. The company's agent pays through an access key whose recipient allowlist is enforced by the protocol, so approving a payee is an onchain signature by a human, and a payment to anyone else reverts with `CallNotAllowed`, even if the agent was fooled and Bound's own checks were switched off. Bound never custodies funds and never holds a key that can move them outside that allowlist.

```
PAYEE SIDE                         BOUND (open source)                        PAYER SIDE (a company)
┌──────────────────┐   proves   ┌──────────────────────────────┐  verify  ┌───────────────────────────┐
│ Acme Ltd         │──domain───▶│ BoundRegistry (Tempo)        │◀─payee?──│ Reference AP agent        │
│ wallet signs,    │  LEI,      │ server: verification, index, │          │ (Claude tool runner):     │
│ optional virtual │  wallet    │ resolver, approvals, agent   │─verdict─▶│ reads invoices, pays with │
│ master (perm.)   │            │ MCP: verify_payee (read-only)│          │ a SCOPED ACCESS KEY       │
└──────────────────┘            └──────────────────────────────┘          └────────────┬──────────────┘
                                                                          new payee?   │
                                                                          ┌────────────▼──────────────┐
                                                                          │ Dashboard: finance lead   │
                                                                          │ taps Approve → root key   │
                                                                          │ signs setAllowedCalls     │
                                                                          └───────────────────────────┘
```

## How it works on Tempo

**Access keys with recipient allowlists.** Each company (org) gets an agent access key that its root account authorizes through Tempo's AccountKeychain (`authorizeKey`): a per-period spending limit plus one call scope, `transferWithMemo` on the stablecoin, restricted to a list of recipients. Bound holds only this scoped key, encrypted at rest.
- The allowlist matches the literal `to` address. A virtual address has to be allowlisted as written, not as its master.
- Tempo allows at most 57 recipients per key scope. Bound refuses to build a longer list.
- An empty recipient list means *unrestricted* (anyone can be paid), so Bound never writes one. A new key starts with the org's own root address as a sentinel, and reads fail closed: a key with no restriction is reported as misconfigured and never paid from.
- Approving a payee means the human's root account signs `setAllowedCalls` with the new list. Paying anyone else reverts onchain with `CallNotAllowed`.

**Virtual addresses (TIP-1022).** An address of the form `masterId | 0xfd×10 | userTag` forwards to a registered master wallet. A master registration is permanent, so a payee that uses one can't quietly swap wallets. Bound resolves a virtual address to its master before looking it up in the registry and blocks unregistered virtual addresses, which Tempo itself rejects.

**BoundRegistry.** A small contract ([`contracts/src/BoundRegistry.sol`](contracts/src/BoundRegistry.sol)) that only Bound's attester writes and anyone can read. Each entry holds the payee's legal name, DNS-verified domain, optional LEI and virtual master, and a level (1 = domain + wallet, 2 = also an LEI entity match). A domain has one current wallet. A wallet change is a `supersede`, and the new wallet only becomes active after a **72-hour cooling-off** period. Payers who pinned the old wallet get a changed-wallet alert. Verifications can also be revoked. A legal name that another company (other wallet, other domain) already holds in the registry can only be attested again at level 2, with an LEI whose GLEIF name matches.

**Verdicts** (`packages/core`):

| Verdict | When | Action |
|---|---|---|
| `MATCH` | verified payee, name matches | PAY if the wallet is on the org's allowlist, else ASK once |
| `CLOSE_MATCH` | verified payee but the name is only close (e.g. a different suffix), a verified payee whose own registered domain is the newer of two lookalike registrations (it imitates an older verified company's domain; the older registration is not flagged, and keeps its age across a wallet rotation), an unregistered wallet whose name resembles a verified payee, or the invoice was sent from another payee's domain | ASK |
| `NO_MATCH` | unregistered wallet, or the name doesn't match the registered one | ASK |
| `LOOKALIKE` | the address shares its first 4 and last 4 hex characters with a known wallet, the invoice claims a verified company but pays an unverified wallet, or an unregistered wallet is invoiced from a domain imitating a registered one | BLOCK |
| `CHANGED` | the wallet was superseded, or is still in its cooling-off period | BLOCK |
| `REVOKED` | the verification was revoked | BLOCK |

PAY needs both a verdict and the onchain allowlist. Pins (wallets a human approved before) and the allowlist are per org, and Bound re-verifies right before every payment. It never trusts the agent's reading of the invoice. Bound pays in USD stablecoins only: an invoice in any other currency (anything but USD, USDC, USDC.e or pathUSD) is failed as `currency_unsupported` and never paid.

## Architecture

| Path | What |
|---|---|
| `packages/core` | Verdict engine (names, confusables, lookalike addresses/domains), Tempo helpers (networks, keychain calls, allowlist reads, virtual-address resolution, pay with memo), registry ABI |
| `contracts` | `BoundRegistry` (Foundry) |
| `apps/server` | Express API + SQLite: payee verification (EIP-712 wallet signature, DNS TXT, GLEIF LEI, virtual master), registry indexer, `/v1/verify` and `/v1/verify-service`, orgs, approvals and payments, the reference AP agent, the attack lab, the public demo (with a demo MPP paid API), early-access sign-ups and the public MCP endpoint |
| `apps/web` | Next.js app: landing (with an early-access sign-up), public lookup/verify, payee verification, org dashboard, attack lab and the public demo (`/try`) |
| `packages/sdk` | `@bound/sdk`: typed client for the verify API, `createGuardedFetch` for MPP payments, and the allowlist helpers used to approve payees |

## Run locally (Tempo testnet)

Needs Node 22, pnpm 10 and [Foundry](https://getfoundry.sh). Every demo script refuses to run unless `TEMPO_NETWORK=testnet` (or `--network testnet`), and checks that the RPC reports chain id 42431 (Moderato) before sending anything. Testnet funds come from the Moderato faucet automatically.

```bash
pnpm install
(cd contracts && forge build)

export TEMPO_NETWORK=testnet
pnpm --filter @bound/server demo:keys       # fresh throwaway keys → apps/server/.env (git-ignored); prints addresses only
pnpm --filter @bound/server demo:deploy     # deploys BoundRegistry(attester), writes its address + deploy block
pnpm --filter @bound/server demo:seed       # attests "Acme Ltd", funds the demo root, creates + authorizes the demo org
pnpm --filter @bound/server demo:lookalike  # mines the lab's lookalike wallet (about 25-35 min on 10 cores)
```

`demo:seed` prints the demo org id and org token (a demo credential for the dashboard) and writes both to `apps/server/.env`. Set `DEMO_PAYEE_DOMAIN=yourdomain.com` before seeding to attest a real domain instead of `acme.example`. Re-running it updates the entry in place. The scripts also write `apps/web/.env.local` (git-ignored, public values only).

Then add `ANTHROPIC_API_KEY` to `apps/server/.env` (the agent reads invoices with it; to reach Claude through an Anthropic-compatible gateway such as 0G Compute's router, also set `ANTHROPIC_BASE_URL=https://router-api.0g.ai` and `AGENT_MODEL=claude-opus-5`, with the gateway's key as `ANTHROPIC_API_KEY`) and run:

```bash
pnpm dev:server                                   # http://localhost:8787
pnpm dev:web                                      # http://localhost:3000
pnpm --filter @bound/server demo:rehearse         # the 8 demo scenarios, asserted, with explorer links
pnpm --filter @bound/server demo:public-org       # once: the separate org the public /try demo runs on
pnpm --filter @bound/server demo:public-allow-acme  # once: lets that org pay Acme (paid-API scenarios 6-8)
pnpm --filter @bound/server demo:rehearse --fresh-org   # re-run on a new org (scenario 1 needs an org that has never paid Acme)
```

`DEMO_ROOT_PRIVATE_KEY` is **demo only**. It stands in for a customer's own root wallet so the seed and rehearsal can sign approvals. In the product, the customer's wallet signs the prepared `authorizeKey` / `setAllowedCalls` calls, and Bound never sees their root or admin keys.

## Tests

```bash
pnpm test                          # core, server, sdk (vitest)
pnpm typecheck                     # every package, including apps/web
(cd contracts && forge test)       # BoundRegistry
pnpm --filter @bound/web lint

# live testnet checks (throwaway keys, Moderato only)
pnpm --filter @bound/core testnet            # keychain allowlist behaviour
pnpm --filter @bound/core testnet:guard-off  # guard-off transfer is mined and reverts
pnpm --filter @bound/server testnet:lab      # the same through the server's lab path
```

## Deployments

### Tempo testnet (Moderato, chain 42431)

| | Address / tx |
|---|---|
| BoundRegistry | [`0xC5179D8D532cecDCD3d4121D5d4328A3Ac12704B`](https://explore.testnet.tempo.xyz/address/0xC5179D8D532cecDCD3d4121D5d4328A3Ac12704B) |
| Deploy block | `37436530`, tx [`0xcfdfac46…8f5e10`](https://explore.testnet.tempo.xyz/tx/0xcfdfac46bd16ec32453222d0d80a482cbb5931f3a7887b6e62eb0cee638f5e10) |
| Attester | [`0x65A2784Dd35Cd31cF0C20f019Bba2f8359cd4504`](https://explore.testnet.tempo.xyz/address/0x65A2784Dd35Cd31cF0C20f019Bba2f8359cd4504) |
| Demo payee "Acme Ltd" (`acme.example`, level 1) | [`0xc1a53DA961B7A3A62db84Ae889f57fa818d3C426`](https://explore.testnet.tempo.xyz/address/0xc1a53DA961B7A3A62db84Ae889f57fa818d3C426), attested in tx [`0x2aa5de99…399dd4`](https://explore.testnet.tempo.xyz/tx/0x2aa5de99ccdcaaa0ef4cfd66ad6f4d3d65d0a4ff7f601f36a8b5c9182c399dd4) |
| Lab lookalike (same first 4 + last 4 hex chars) | [`0xC1A5d69D86Dea5CA36F7aE391b6610CfFB96C426`](https://explore.testnet.tempo.xyz/address/0xC1A5d69D86Dea5CA36F7aE391b6610CfFB96C426) |
| Lab unregistered wallet | [`0x052840688919bA6Afaf0f15B6dEeb037d43836aE`](https://explore.testnet.tempo.xyz/address/0x052840688919bA6Afaf0f15B6dEeb037d43836aE) |
| Demo org root (demo only) | [`0x06dc65C749734F95534BA0102aA629974e8F7943`](https://explore.testnet.tempo.xyz/address/0x06dc65C749734F95534BA0102aA629974e8F7943), agent key authorized in tx [`0x9669e15b…db7cec`](https://explore.testnet.tempo.xyz/tx/0x9669e15b22075d93883c9546b6a2924eb92a4112f57ec11f4871b2943cdb7cec) |
| Token | pathUSD `0x20c0000000000000000000000000000000000000` |

The lookalike was mined to match the full 4 + 4 characters that the core check uses (about 3.2 billion keys in 25 minutes), so no reduced-length fallback is in use. `LOOKALIKE_CHARS` in `apps/server/.env` is only the `demo:lookalike` mining script's record of how many characters it matched; it is not a product setting, and nothing in the server or `packages/core` reads it (the check is always 4 + 4).

### Tempo mainnet

Mainnet: deployment pending (see Testnet above).

### Agent cost controls

Every agent run calls the model on Bound's key, so runs are capped per rolling day: `AGENT_RUNS_PER_DAY` (default 500) across the dashboard, the attack lab and the public demo, and `AGENT_RUNS_PER_ORG_DAY` (default 50) per org (the public demo org is held by `DEMO_RUNS_PER_DAY` instead). A capped request gets `429` with a plain message. Each run's token usage and an estimated cost (`AGENT_PRICE_IN_PER_MTOK` / `AGENT_PRICE_OUT_PER_MTOK`, default $5 / $25 for Claude Opus 5) are stored per invoice; `pnpm --filter @bound/server agent:usage` prints the last 24 hours, all time, cost per run and the busiest orgs.

### Hosted deployment

The server (`apps/server`) and the web app (`apps/web`) deploy separately, for example the server on Railway and the web app on Vercel. Besides the keys in [`.env.example`](.env.example):

| Where | Variable | Value |
|---|---|---|
| server | `WEB_ORIGIN` | The web app's URL (e.g. the Vercel URL), used for CORS |
| server | `LAB_ENABLED` | Leave unset or `false` on mainnet unless the attack lab should run there (see below) |
| server | `DEMO_ORG_ID` | The only org `POST /v1/orgs/:orgId/authorize-demo` will sign for (the seeded demo org). Set it whenever `DEMO_ROOT_PRIVATE_KEY` is set |
| server | `DEMO_PUBLIC_ORG_ID` | The org the public demo (`/try`) runs on, created by `demo:public-org`. Never the same as `DEMO_ORG_ID`; unset, the public demo answers 503 |
| server | `DEMO_RUNS_PER_IP_HOUR`, `DEMO_RUNS_PER_DAY` | Public demo limits: runs per client IP per hour (default 6) and per rolling 24 hours for everyone (default 300; `0` pauses the demo) |
| server | `DEMO_API_RUNS_PER_DAY`, `MPP_SECRET_KEY` | The paid-API demo's daily cap and challenge key (see [Guarding MPP payments](#guarding-mpp-payments)); its public demo org also needs `demo:public-allow-acme` run against this server |
| server | `SIGNUPS_PER_IP_HOUR` | Early-access sign-ups per client IP per hour (default 10) |
| server | `DEMO_ROOT_PRIVATE_KEY` | Demo only. Keep it unset on mainnet unless you are filming the demo |
| web | `NEXT_PUBLIC_API_URL` | The server's public URL |
| web | `NEXT_PUBLIC_TEMPO_NETWORK` | `testnet` or `mainnet`, the same as the server's `TEMPO_NETWORK`. If they differ, the web app shows a red notice and disables every signing button |

### Known limitations

- A lookalike domain that was registered BEFORE the real brand joined Bound counts as the older registration, so the brand's own domain is the one flagged (CLOSE_MATCH). Brands should register early. An LEI (level 2) still lets a late brand verify under its own name, but it does not change which domain counts as older.
- The org token is stored in the browser's `localStorage`: an organization opens in the browser that created it, and anyone with access to that browser profile holds the token.
- Rate limits are in memory and per process: several server instances each keep their own counts.

### Guard-off proof

With Bound's checks switched off, the agent's scoped key tries to pay an address outside its allowlist. Tempo mines the transaction and reverts it with `CallNotAllowed`, and nothing moves:
[`0x73e0470f…0fd63c`](https://explore.testnet.tempo.xyz/tx/0x73e0470fa3c71d69c8879bf633914c49db11d80dad955e7574e3bfdbbe0fd63c). The same refusal through the server's attack-lab path, against this deployment: [`0x1c4e03c2…9f101a`](https://explore.testnet.tempo.xyz/tx/0x1c4e03c2240b25da2195c221c27765f86eb3dd82d2fc061d29f6f6409f1e101a).

## MCP

Bound serves a public, **read-only** MCP endpoint at `https://<server>/mcp` (streamable HTTP) with three tools: `verify_payee` (address, payee name, optional sender domain → verdict + reasons), `verify_payment_request` (an MPP payment request's recipient, the service domain and any split recipients → allow or deny, see [Guarding MPP payments](#guarding-mpp-payments)) and `lookup_payee` (search verified companies by name or domain). It never takes an org, so no allowlist, invoice or payment capability is reachable through it.

```bash
claude mcp add --transport http bound https://<server>/mcp
```

```json
{ "mcpServers": { "bound": { "type": "http", "url": "https://<server>/mcp" } } }
```

The REST equivalent is `POST /v1/verify` with `{ "address", "payeeName", "senderDomain"? }`, and the SDK is in [`packages/sdk`](packages/sdk/README.md).

## Guarding MPP payments

**The 30-second version.** AI agents already pay for APIs through MPP (the Machine Payments Protocol: HTTP 402 on Tempo). A paid API answers `402` with a payment request (amount, currency, **recipient**, optional splits), and nothing checks that the recipient is the service the agent meant to pay, so a hijacked or impersonating API can name any wallet. Bound reads the payment request before the agent signs it:

1. The primary recipient must be the wallet Bound verified for the service's domain (the URL host, or the `serviceDomain` you configure; never taken from the API's own answer).
2. Each split recipient (a platform fee, say) must be an active Bound-verified wallet, or listed in `allowRecipients`.
3. Anything else stops **before signing**: nothing is signed, $0 moves, and `PaymentBlockedError` says why.
4. Tempo is still the second lock: the agent's access key only pays allowlisted wallets, so with the guard off a hijacked payment is refused with `CallNotAllowed`.

The verdict decides: `MATCH` pays; `CLOSE_MATCH` and `NO_MATCH` follow `onAsk` (default `block`); `LOOKALIKE`, `CHANGED` and `REVOKED` always deny. It fails closed: a verification error, a non-zero amount with no recipient, a method other than `tempo`, an intent other than `charge` or `session`, or a chain other than `expectedChainId` all deny. A zero-amount (identity) challenge moves no money and passes.

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

`@bound/sdk` takes your `mppx` client as is (create it with `polyfill: false`, so the guard owns the 402 flow) and has no dependency on `mppx` itself. More in [`packages/sdk`](packages/sdk/README.md).

**Without the SDK.** An agent with MCP calls `verify_payment_request` with `{ recipient, domain?, splits? }` and gets `{ allow, reason, checks }`; it must not pay when `allow` is false. Over REST, `POST /v1/verify-service` `{ address, domain? }` answers with the usual verdict and reasons. With a domain, it asks whether the address is the wallet registered for that domain or a parent of it (`data.acme.example` → `acme.example`); without one, whether it is an active Bound-verified wallet at all. It never takes an org, so its action is never `PAY`: decide on the verdict, as the guard does.

**The demo** (testnet only, mounted with the public demo and never on mainnet, not even with `LAB_ENABLED=true`):

- `GET /v1/demo/api/data[?hijack=1]`: a real MPP paid API (`mppx` `tempo.charge`). It answers `402` asking for 0.01 pathUSD to the Acme demo payee (`DEMO_PAYEE_ADDRESS`), or to the lab lookalike (`LAB_LOOKALIKE_ADDRESS`) with `?hijack=1`, and `200 { data }` once paid.
- `GET /v1/demo/api-runs/status` → `{ status: ready | unavailable | busy, message, runsPerHour }`.
- `POST /v1/demo/api-runs` `{ hijacked, guardOff }` → the whole run, synchronously: `{ steps, outcome: paid | blocked_by_bound | blocked_by_tempo | failed, recipient, txHash, txUrl, message }`. The public demo org's access key buys the data from the demo API (on the server's own `127.0.0.1:PORT`), through `createGuardedFetch` for `acme.example` or with the guard off. No model is involved: it is a scripted agent step. With the guard off and a hijacked API, the refused transfer is also forced onchain so the run can link a mined, reverted transaction. `503` when the public demo org isn't set up, `429` past `DEMO_RUNS_PER_IP_HOUR` or `DEMO_API_RUNS_PER_DAY`, `400` for a bad body (which doesn't spend a run).

This is the "Buy data from a paid API" scenario on `/try`, and `demo:rehearse` scenarios 6-8. For honest runs to pay, the public demo org's allowlist must hold Acme's wallet: run `pnpm --filter @bound/server demo:public-allow-acme` once per public demo org, including a hosted server's (see [Public demo](#public-demo-try)). Without it, honest runs end "blocked by Tempo".

| Variable | What |
|---|---|
| `DEMO_API_RUNS_PER_DAY` | Paid-API demo runs per rolling 24 hours for everyone (default 200, `0` pauses it). The per-IP limit is `DEMO_RUNS_PER_IP_HOUR` |
| `MPP_SECRET_KEY` | HMAC key binding the demo API's 402 challenges, at least 32 bytes (a shorter one stops the server). Unset, it is derived from `SERVER_SECRET` |
| `DEMO_PAYEE_ADDRESS` | The wallet the honest demo API asks to be paid (`demo:keys` writes it). On testnet it defaults to the Acme wallet in [Deployments](#tempo-testnet-moderato-chain-42431); never defaulted on mainnet |
| `LAB_LOOKALIKE_ADDRESS` | The wallet the hijacked demo API names (`demo:lookalike` writes it). On testnet it defaults to the lab lookalike in [Deployments](#tempo-testnet-moderato-chain-42431); never defaulted on mainnet |

## Attack lab and `LAB_ENABLED`

The attack lab (`POST /v1/lab/:orgId/run`) runs the agent on an attacker-written invoice. With *guard off*, Bound's payee checks are skipped and the lab only broadcasts transfers that Tempo is certain to refuse, so the refusal shows up as a public reverted transaction. It is always on for testnet. On mainnet it's off unless `LAB_ENABLED=true`. **Note:** on mainnet, `LAB_ENABLED=true` also enables *guarded* lab runs, and those go through the normal payment path, so they **can make real payments to payees the org has approved**.

## Public demo (`/try`)

`/try` is the attack lab for visitors with no wallet: write the scam invoice (or pick a preset), switch Bound's software on or off, and watch the agent. It runs the same lab flow on its own org, `DEMO_PUBLIC_ORG_ID`, never on the filmed demo org (`DEMO_ORG_ID`); that org's token and agent key never leave the server. Create it once the server is running (testnet only):

```bash
pnpm --filter @bound/server demo:public-org   # fresh org, demo root, 50 USD/day; writes DEMO_PUBLIC_ORG_ID, then restart the server
```

It creates the org through the API (`BOUND_API_URL`, default the local server), authorizes its agent key with the demo root, and records the id (and the org token, never printed) in `apps/server/.env`; it refuses to replace an existing one without `--replace`. On a hosted server, point `BOUND_API_URL` at it and set `DEMO_PUBLIC_ORG_ID` in its environment.

The new key's allowlist starts with no payees. `demo:public-allow-acme` adds the Acme demo payee once (the demo root signs it, testnet only), so honest public runs **pay real testnet money to Acme**: the "Real Acme invoice" preset pays 12.50 pathUSD and a paid-API run 0.01 pathUSD (an invoice a visitor writes to Acme's verified wallet pays its own amount). Both kinds of run share the org key's 50 pathUSD/day spending limit, so a large invoice can use up the day and later payments fail until the period rolls over. Unverified wallets are still never paid: Bound blocks them or asks for approval, and with Bound off Tempo refuses them (`CallNotAllowed`).

```bash
pnpm --filter @bound/server demo:public-allow-acme   # once per public demo org; prints the allowlist tx, "Nothing sent" if Acme is already on it
```

It needs `TEMPO_NETWORK=testnet`, `DEMO_PUBLIC_ORG_ID`, `DEMO_PUBLIC_ORG_TOKEN`, `DEMO_PAYEE_ADDRESS` and `DEMO_ROOT_PRIVATE_KEY`, and refuses the filmed org and a key with no recipient restriction. A **hosted** server has its own public demo org (created with `demo:public-org` against it), and that org needs the script too: run it with `BOUND_API_URL` pointing at the hosted server and that org's `DEMO_PUBLIC_ORG_ID` and `DEMO_PUBLIC_ORG_TOKEN` in the environment. Until then its honest paid-API runs end "blocked by Tempo".

- `GET /v1/demo`: whether a run can start (`ready`, `unavailable`, `offline` or `busy`), the per-hour limit and the 4,000-character invoice cap.
- `POST /v1/demo/runs` `{ text, guardOff }` → `202 { runId }`, a 128-bit id. `503` when `DEMO_PUBLIC_ORG_ID` isn't set up (no fallback to `DEMO_ORG_ID`) or `ANTHROPIC_API_KEY` is empty, `429` past `DEMO_RUNS_PER_IP_HOUR` or `DEMO_RUNS_PER_DAY`, `400` for a bad body (which doesn't spend a run).
- `GET /v1/demo/runs/:runId`: that run's status, verdict, payment (with explorer link) and agent log. Never the org, the raw text or the model's error text: a run whose model call failed reads *The demo AI is offline right now.*

It is mounted on testnet only, never on mainnet, not even with `LAB_ENABLED=true`. Public runs are lab invoices of the public demo org, so its lab, dashboard and approval queue fill up with visitors' runs; the filmed demo org stays clean.

## Early-access sign-ups

The landing page's sign-up card posts `{ email, role: payer | supplier | builder | other, company? }` to `POST /v1/signups`. Emails are stored trimmed and lower-cased, once each; a new and a repeated email get the same `201`, and nothing lists them over the API. Count them on the server:

```bash
pnpm --filter @bound/server signups:count   # total and per role, never an email
```

## Demo script

Rehearsed end to end by `demo:rehearse` against the running server:

1. **A real Acme invoice arrives (INV-1042).** The agent verifies it: `MATCH`, but Acme is a new payee for this company, so the result is ASK. The finance lead taps Approve, which is one root-key signature adding Acme to the key's allowlist. The invoice is paid, and the explorer shows the transfer with memo `INV-1042`.
2. **Acme's next invoice (INV-1043)** pays itself: MATCH and allowlisted, no human needed.
3. **"We've changed wallets"**: the invoice looks identical, but the pay-to address is a mined lookalike (`0xC1A5…C426` vs `0xc1a5…C426`). The verdict is `LOOKALIKE`, so it's blocked before anything is sent.
4. **Guard off**: in the attack lab, an injected invoice tells the agent to skip verification, and Bound's checks are disabled. The agent tries to pay the attacker. Tempo refuses it onchain (`CallNotAllowed`) and the dashboard shows `chain_rejected` with the reverted transaction.
5. **Compromised real domain**: the invoice really comes from `billing@acme.example`, but it pays a brand-new unregistered wallet. The verdict is `LOOKALIKE` (`claims_verified_payee`: it claims to be a verified company but pays an unverified address), so it's blocked.
6. **A paid API, honest**: an agent step buys a price index from the demo MPP API. The 402 names Acme's verified wallet, Bound says `MATCH`, and the agent pays 0.01 pathUSD and gets the data.
7. **The same API, hijacked**: the 402 names the lookalike wallet. Bound says `LOOKALIKE` and stops the payment before anything is signed.
8. **Hijacked, Bound off**: the agent signs whatever the API asks. Tempo refuses it (`CallNotAllowed`), and the forced transfer is mined and reverts.

Close: *Your AI agent can't pay a stranger.*
