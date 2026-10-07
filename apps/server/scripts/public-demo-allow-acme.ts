// Lets the public demo org (DEMO_PUBLIC_ORG_ID) pay the Acme demo payee, so the paid-API demo's honest run can pay it
// (/v1/demo/api-runs: real 0.01 pathUSD transfers, bounded by the org key's limit and the demo's caps). TESTNET ONLY.
// Through a RUNNING Bound server (BOUND_API_URL, default the local one) it reads the org's root and agent key with the org's
// token, then the demo root signs setAllowedCalls with the key's live allowlist plus DEMO_PAYEE_ADDRESS. The root sentinel
// stays; the list is never empty and never unrestricted. Idempotent: nothing is sent when Acme is already allowed.
// Never prints keys or tokens.
// Usage: TEMPO_NETWORK=testnet tsx scripts/public-demo-allow-acme.ts
import { getAddress } from 'viem'
import { AllowlistError, buildSetAllowlistCall, readAllowlist, txUrl } from '@bound/core'
import { allowlistWith, assertTestnetChain, boundApi, demoRootClient, die, ensureFunded, need, requireTestnet, signAsRoot } from './lib'

const { net, pub } = requireTestnet()
await assertTestnetChain(pub)

const orgId = need('DEMO_PUBLIC_ORG_ID')
if (orgId === process.env.DEMO_ORG_ID) die('DEMO_PUBLIC_ORG_ID is the filmed demo org (DEMO_ORG_ID); refusing to change its allowlist')
const token = need('DEMO_PUBLIC_ORG_TOKEN')
const payee = getAddress(need('DEMO_PAYEE_ADDRESS'))

const API = process.env.BOUND_API_URL || `http://localhost:${process.env.PORT || 8787}`
const api = boundApi(API)
const health = await api('GET', '/health').catch((e) => die(`server not reachable at ${API} (${(e as Error).message}); start it with \`pnpm --filter @bound/server dev\``))
if (health.network !== 'testnet') die(`server at ${API} runs on ${health.network}, expected testnet`)
const { org } = await api('GET', `/v1/orgs/${orgId}/overview`, undefined, token).catch((e) => die(`could not read the public demo org: ${(e as Error).message.split(' {')[0]}`))
if (!org?.authorized) die(`public demo org ${orgId} has not authorized its agent key yet (run demo:public-org)`)
const rootAddress = getAddress(org.rootAddress)
const keyId = getAddress(org.agentKeyAddress)

const root = demoRootClient(net)
await assertTestnetChain(root)
if (root.account.address !== rootAddress) die(`the public demo org's root is ${rootAddress}, not the demo root ${root.account.address}`)

const read = () => readAllowlist(pub, { account: rootAddress, keyId, token: net.token }).catch((e) => {
  if (e instanceof AllowlistError) die(`refusing to touch the key: ${e.message}`) // an unrestricted key is a misconfiguration, never "fixed" here
  throw e
})
const live = await read()
// the live list (with the root sentinel kept, or restored) plus Acme; buildSetAllowlistCall refuses an empty list
const next = allowlistWith(live, rootAddress, payee)
if (!next) {
  console.log(`Acme ${payee} is already on public demo org ${orgId}'s allowlist (${live.length} recipients). Nothing sent.`)
  process.exit(0)
}
const call = buildSetAllowlistCall({ keyId, token: net.token, recipients: next })

await ensureFunded(pub, rootAddress, 'demo root') // it pays the transaction's fee
await assertTestnetChain(root)
const tx = await signAsRoot(root, call)
const after = await read()
if (!after.includes(payee) || !after.includes(rootAddress)) die(`allowlist after ${txUrl('testnet', tx)} is ${after.join(', ')}: Acme or the root sentinel is missing`)
console.log(`Public demo org ${orgId} may now pay Acme ${payee}: ${txUrl('testnet', tx)}`)
console.log(`Allowlist (${after.length}): ${after.join(', ')}`)
process.exit(0)
