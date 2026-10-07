// Spike (MPP payment guard, Task 1): can the mppx Tempo client pay an HTTP 402 with a Tempo ACCESS KEY on
// Moderato, in pull and/or push mode, and what happens when the API names a recipient outside the key's allowlist?
// TESTNET ONLY. Authorizes a throwaway agent key on the demo root (allowlist: the Acme demo payee only, 1 pathUSD
// per day), starts a throwaway mppx/express paid API on a random port, then pays it honest and hijacked in each mode
// and prints a table. Also prints the parsed challenge shape (rawFetch + preparePayment) the guard will inspect.
// Kept as a probe. Never prints keys.
// Usage: TEMPO_NETWORK=testnet tsx scripts/mpp-spike.ts
import express from 'express'
import type { AddressInfo } from 'node:net'
import { createClient, getAddress, http, publicActions, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts'
import { Mppx, tempo } from 'mppx/client'
import { Mppx as ServerMppx, tempo as tempoServer } from 'mppx/express'
import { Receipt } from 'mppx'
import { agentAccount, buildAuthorizeKeyCall, decodeTempoError, readAllowlist, txUrl } from '@bound/core'
import { assertTestnetChain, demoRootClient, die, ensureFunded, need, requireTestnet, signAsRoot, TESTNET_CHAIN_ID, tokenBalance } from './lib'

const { net, pub } = requireTestnet()
await assertTestnetChain(pub)
const PATHUSD = net.token
const payee = getAddress(need('DEMO_PAYEE_ADDRESS'))
const lookalike = getAddress(need('LAB_LOOKALIKE_ADDRESS'))

// ---- 1. a throwaway agent key, scoped to the honest payee only ----
const root = demoRootClient(net)
await assertTestnetChain(root)
await ensureFunded(pub, root.account.address, 'demo root')
const agentKey = generatePrivateKey()
const keyId = privateKeyToAddress(agentKey)
const authTx = await signAsRoot(root, buildAuthorizeKeyCall({
  keyId, token: PATHUSD, limit: 1_000_000n, periodSeconds: 86_400n,
  expiry: BigInt(Math.floor(Date.now() / 1000) + 86_400), recipients: [payee],
}))
const allowlist = await readAllowlist(pub, { account: root.account.address, keyId, token: PATHUSD })
console.log(`root ${root.account.address}, agent key ${keyId}\nauthorizeKey ${txUrl('testnet', authTx)}\nallowlist ${allowlist.join(', ')}`)
const agent = agentAccount(agentKey, root.account.address)

// One Moderato client for both sides; anything asking for another chain is refused.
const moderato = createClient({ chain: net.chain, transport: http(net.rpc) }).extend(publicActions)
await assertTestnetChain(moderato)
const getClient = ({ chainId }: { chainId?: number | undefined }) => {
  if (chainId !== undefined && chainId !== TESTNET_CHAIN_ID) throw new Error(`spike refuses chain ${chainId}: testnet (${TESTNET_CHAIN_ID}) only`)
  return moderato
}

// ---- 2. the demo paid API ----
const server = ServerMppx.create({
  methods: [tempoServer.charge({ testnet: true, currency: PATHUSD, getClient })],
  secretKey: 'spike-secret-spike-secret-spike-secret-1234',
  realm: 'bound-mpp-spike',
})
const app = express()
// Counts retries that carry a payment credential, to tell a client-side refusal from a server-side one.
let credentialsSeen = 0
app.use((req, _res, next) => { if (/^Payment /i.test(req.headers.authorization ?? '')) credentialsSeen++; next() })
app.get('/paid', (req, res, next) =>
  server.charge({ amount: '0.01', currency: PATHUSD, recipient: req.query.hijack ? lookalike : payee, description: 'spike data' })(req, res, next),
  (_req, res) => { res.json({ data: 'paid content' }) })
// Inspection only (never paid): a platform-fee split to the lookalike, to see the splits shape.
app.get('/split', server.charge({ amount: '0.01', currency: PATHUSD, recipient: payee, splits: [{ recipient: lookalike, amount: '0.002' }] }), (_req, res) => { res.json({ data: 'never' }) })
const listener = app.listen(0)
await new Promise((r) => listener.once('listening', r))
const base = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`

const clientFor = (mode: 'pull' | 'push') => Mppx.create({
  methods: [tempo.charge({ account: agent, mode, getClient, expectedChainId: TESTNET_CHAIN_ID, allowedChainIds: [TESTNET_CHAIN_ID] })],
  polyfill: false,
})

// ---- 4. the challenge shape the guard reads (no signing) ----
const inspector = clientFor('pull')
for (const path of ['/paid', '/paid?hijack=1', '/split']) {
  const res = await inspector.rawFetch(`${base}${path}`)
  const wire = res.headers.get('www-authenticate') ?? ''
  const payment = await inspector.preparePayment(res, { request: {} })
  console.log(`\n${path} → HTTP ${res.status}\n  method ${payment.challenge.method}, intent ${payment.challenge.intent}, expires ${payment.challenge.expires}\n  request ${JSON.stringify(payment.challenge.request)}`)
  const m = /request="([^"]+)"/.exec(wire)
  if (m?.[1]) console.log(`  wire request (base64url-decoded) ${Buffer.from(m[1], 'base64url').toString('utf8')}`)
  if (path === '/paid') console.log(`  full challenge ${JSON.stringify(payment.challenge)}\n  WWW-Authenticate ${wire.replace(/request="[^"]+"/, 'request="…"')}`)
}

// ---- 3. pay: honest and hijacked, pull and push ----
const rows: { mode: string; api: string; outcome: string; detail: string }[] = []
const short = (e: unknown) => {
  const err = e as any
  const d = decodeTempoError(e)
  const msg = (err?.shortMessage ?? err?.message ?? String(e)).split('\n').slice(0, 3).join(' | ')
  const chain: string[] = []
  for (let c = err; c && chain.length < 6; c = c.cause) chain.push(c.name ?? typeof c)
  return `${err?.name ?? 'Error'} [decoded ${d.code}; causes ${chain.join(' > ')}]: ${msg.slice(0, 400)}`
}
for (const mode of ['pull', 'push'] as const) {
  for (const hijack of [false, true]) {
    const to = hijack ? lookalike : payee
    const before = await tokenBalance(pub, to)
    const seen = credentialsSeen
    try {
      const res = await clientFor(mode).fetch(`${base}/paid${hijack ? '?hijack=1' : ''}`)
      const header = res.headers.get('payment-receipt')
      const receipt = header ? Receipt.deserialize(header) : undefined
      const ref = (receipt as any)?.reference as Hex | undefined
      const body = await res.text()
      rows.push({ mode, api: hijack ? 'hijacked' : 'honest', outcome: `HTTP ${res.status}`, detail: `${ref ? txUrl('testnet', ref) : 'no receipt'} ${body.slice(0, 120)}` })
      if (receipt) console.log(`\nreceipt (${mode}, ${hijack ? 'hijacked' : 'honest'}) ${JSON.stringify(receipt)}`)
    } catch (e) {
      rows.push({ mode, api: hijack ? 'hijacked' : 'honest', outcome: 'THROWS', detail: short(e) })
    }
    const after = await tokenBalance(pub, to)
    rows[rows.length - 1]!.detail += ` | ${hijack ? 'lookalike' : 'payee'} balance ${Number(before) / 1e6} → ${Number(after) / 1e6} | credentials sent to the API: ${credentialsSeen - seen}`
  }
}

listener.close()
console.log('\n| mode | API | outcome | detail |\n|---|---|---|---|')
for (const r of rows) console.log(`| ${r.mode} | ${r.api} | ${r.outcome} | ${r.detail.replace(/\|/g, '/')} |`)
if (!rows.some((r) => r.api === 'honest' && r.outcome === 'HTTP 200')) die('the honest payment did not succeed in either mode (fallback needed)')
process.exit(0)
