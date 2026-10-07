# MPP payment guard — design

**Date:** 2026-10-07 · **Status:** approved in conversation (founder: "yes go ahead, update the pitch book, plan and then build") · **Deadline:** Oct 12, 2026

## Problem

AI agents already pay for APIs today through MPP (Machine Payments Protocol, Tempo and Stripe's HTTP 402 standard).
A paid API answers `402` with a payment request (amount, currency, **recipient**, optional splits). Nothing checks that the
recipient is really the service the agent meant to pay. A hijacked or impersonating API can name any wallet.

## What it does

Before an agent signs an MPP payment, Bound reads the payment request and checks every recipient:

1. **Primary recipient** must be the wallet Bound has verified for the service's domain (the URL host, or an explicit `serviceDomain`).
2. **Split recipients** (platform fees and the like) must each be an active Bound-verified wallet, or be listed in `allowRecipients`.
3. Anything else stops **before signing**: nothing is signed, $0 moves, and the error says why.
4. Tempo still enforces it: the agent's access key only allows approved recipients, so with the guard off a hijacked API still gets `CallNotAllowed`.

## Parts

| Part | Where | Notes |
|---|---|---|
| Pure inspection and decision logic | `packages/core/src/mpp.ts` | `inspectChallenge`, `decidePayment`; no network |
| Guarded fetch for any MPP agent | `packages/sdk/src/guard.ts` | `createGuardedFetch`; takes the caller's `mppx` instance structurally, so `@bound/sdk` has no hard dependency on `mppx` |
| Service check endpoint | `POST /v1/verify-service` | `{ address, domain? }` → the normal verdict. Reuses `verifyPayee`. Domain given: is this wallet the one registered for that domain. Domain omitted: is this wallet an active Bound-verified wallet |
| MCP tool | `verify_payment_request` in `apps/server/src/mcp.ts` | `{ recipient, domain?, splits? }` → allow/deny with reasons |
| Demo paid API | `apps/server/src/routes/demo-api.ts` | `mppx/express` `tempo.charge`; testnet only; `?hijack=1` makes it name the lookalike wallet |
| Public demo run | `POST /v1/demo/api-runs` | Deterministic (no LLM): an agent step buys data from the demo API with the public demo org's access key; guard on/off, API honest/hijacked |
| `/try` scenario | `apps/web/app/try` | "Buy data from a paid API" beside the invoice scenarios |

## Decisions

- **Fail closed.** A verification error, a missing recipient on a non-zero amount, an unsupported method or intent, or a
  chain mismatch all deny. Only `tempo/charge` and `tempo/session` are supported; zero-amount identity challenges move no money and are allowed.
- **Verdict, not action, decides.** `verify-service` has no org, so `decideAction` can never return PAY. The guard allows on
  `MATCH`; `CLOSE_MATCH` and `NO_MATCH` follow `onAsk` (default `block`); `LOOKALIKE`, `CHANGED` and `REVOKED` always deny.
- **`serviceDomain` is caller configuration, never taken from the API's own response.** The demo API runs on our own host, so the
  demo run passes `serviceDomain: 'acme.example'` (the registered demo payee).
- **The demo run is deterministic and costs nothing in model tokens.** It is the payment client, not a language model, that the guard protects. The page says "agent step", not "AI".
- **Demo payments are real testnet transfers** of 0.01 pathUSD from the public demo org, bounded by its key's spending limit, the per-IP limit and the daily cap.
- **No new registrations.** The honest service wallet is the already-registered Acme demo payee; the hijack wallet is the existing lab lookalike.
- **Out of scope:** publishing `@bound/sdk` to npm, MPP `subscription` intent, `evm`/`stripe` methods, verifying individuals, a consumer app.

## Success criteria

- A guarded fetch against the honest demo API pays and returns the data.
- Against the hijacked API it throws `PaymentBlockedError` before `createCredential` is ever called.
- With the guard off, the hijacked payment is rejected by Tempo (`CallNotAllowed`), with an explorer link where the chain gives one.
- All of the above runs on `/try` with no wallet, and in `demo:rehearse`.
