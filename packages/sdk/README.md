# @bound/sdk

Your AI agent can't pay a stranger. Bound verifies a payee before stablecoin money moves on Tempo. This SDK wraps the public verify API, guards MPP (HTTP 402) payments with `createGuardedFetch`, and re-exports the allowlist helpers used to approve payees.

Verdicts: `MATCH`, `CLOSE_MATCH`, `NO_MATCH`, `LOOKALIKE`, `CHANGED`, `REVOKED`. Actions: `PAY`, `ASK`, `BLOCK`.

## Install

Not published to npm yet. Inside this monorepo, depend on the workspace package:

```json
{ "dependencies": { "@bound/sdk": "workspace:*" } }
```

## Verify a payee

```ts
import { BoundClient } from '@bound/sdk'

const bound = new BoundClient({ baseUrl: 'https://<server>', token: process.env.BOUND_TOKEN })

const r = await bound.verifyPayee({
  address: '0x1111111111111111111111111111111111111111',
  payeeName: 'Acme Inc',
  senderDomain: 'acme.com', // optional
})

if (r.action === 'PAY') {
  // safe to send
} else if (r.action === 'ASK') {
  // ask a human
} else {
  // BLOCK: do not pay
}

const known = await bound.getPayee('0x1111111111111111111111111111111111111111') // null if unknown
```

Non-2xx responses throw an `Error` carrying the server's `error` message. `getPayee` returns `null` only on 404.

## Guard MPP payments

A paid API answers `402` with a payment request that names who to pay. `createGuardedFetch` reads that request and asks Bound about every recipient **before** your agent signs anything. The primary recipient must be the wallet Bound verified for the service you mean to pay (`serviceDomain`, default the URL's hostname; never taken from the API's answer), and each split recipient must be an active Bound-verified wallet or be listed in `allowRecipients`. Anything else throws `PaymentBlockedError`: nothing is signed and no money moves.

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

`mppx` is your dependency, not the SDK's: pass your own client, created with `polyfill: false` so the guard owns the 402 flow (it uses `rawFetch` and `preparePayment`). A response that isn't a `402` passes straight through.

| Option | |
|---|---|
| `bound` | Anything with `verifyService({ address, domain? })`, usually a `BoundClient` |
| `mppx` | Your `mppx` client (`polyfill: false`) |
| `serviceDomain` | The service you mean to pay. Default: the URL's hostname |
| `allowRecipients` | Addresses accepted without a Bound check (a platform-fee split you trust), case-insensitive |
| `onAsk` | `'block'` (default) or `'allow'`: what `CLOSE_MATCH` and `NO_MATCH` do. `LOOKALIKE`, `CHANGED` and `REVOKED` always block |
| `expectedChainId` | Deny a payment request for any other chain (Tempo testnet is `42431`) |
| `onDecision` | Called with every decision (`{ allow, reason, checks, url }`), allowed or not |

It fails closed: a Bound error, a non-zero amount without a recipient, a method other than `tempo`, an intent other than `charge` or `session`, or a chain mismatch all deny. A zero-amount (identity) challenge moves no money and passes.

```ts
import { PaymentBlockedError } from '@bound/sdk'

try {
  await guardedFetch('https://api.acme.com/quote')
} catch (e) {
  if (e instanceof PaymentBlockedError) console.log(e.decision.reason, e.decision.checks) // nothing was signed
  else throw e
}
```

Keep Tempo's second lock as well: give the agent an access key whose recipient allowlist holds only the services it may pay (see [Approval pattern](#approval-pattern)), so a payment the guard misses is still refused onchain with `CallNotAllowed`.

## Verify a service wallet

The check the guard makes, on its own:

```ts
const r = await bound.verifyService({ address: '0xc1a53DA961B7A3A62db84Ae889f57fa818d3C426', domain: 'acme.example' })
// r.verdict is MATCH when it is the wallet Bound verified for acme.example (the domain you pass, or a parent of it)
```

Without a `domain` it answers whether the address is an active Bound-verified wallet at all. It never takes an org, so `action` is never `PAY`: decide on `verdict`, as the guard does (`POST /v1/verify-service`).

## MCP

Bound exposes a remote MCP endpoint at `https://<server>/mcp` (streamable HTTP) with three read-only tools: `verify_payee`, `verify_payment_request` (an MPP payment request's recipient, service domain and splits → `{ allow, reason, checks }`; never pay when `allow` is false) and `lookup_payee`.

Claude Code:

```bash
claude mcp add --transport http bound https://<server>/mcp
```

Claude Desktop / any client using an `mcpServers` config:

```json
{
  "mcpServers": {
    "bound": {
      "type": "http",
      "url": "https://<server>/mcp"
    }
  }
}
```

## Approval pattern

After a payee verifies and a human approves, add its wallet to the key's on-chain recipient allowlist:

```ts
import { readAllowlist, withRecipient, buildSetAllowlistCall } from '@bound/sdk'

const current = await readAllowlist(client, { account, keyId, token })
const next = withRecipient(current, payeeWallet)
const call = buildSetAllowlistCall({ keyId, token, recipients: next })
// sign and send `call` with the account's root/admin key (not the agent key)
```

`readAllowlist` fails closed: for an unscoped key, or a scope whose recipient list is empty, it throws `AllowlistError` ("unrestricted: ..."). On Tempo an empty recipient list means ANY recipient is allowed, so never write one. `buildSetAllowlistCall` also refuses empty lists.
