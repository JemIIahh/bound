# @bound/sdk

Your AI can't pay a stranger. Bound verifies a payee before stablecoin money moves on Tempo. This SDK wraps the public verify API and re-exports the allowlist helpers used to approve payees.

Verdicts: `MATCH`, `CLOSE_MATCH`, `NO_MATCH`, `LOOKALIKE`, `CHANGED`, `REVOKED`. Actions: `PAY`, `ASK`, `BLOCK`.

## Install

```bash
pnpm add @bound/sdk
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

## MCP

Bound exposes a remote MCP endpoint at `https://<server>/mcp` (streamable HTTP) with two read-only tools: `verify_payee` and `lookup_payee`.

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
