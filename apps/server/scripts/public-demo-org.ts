// Creates the org the public demo (/try, /v1/demo) runs on, so visitors never touch the filmed demo org
// (DEMO_ORG_ID). Through a RUNNING Bound server on Tempo TESTNET, it creates a fresh org with the demo root
// and the seeded demo org's limits (50 USD per day), and authorizes its agent key with the demo root. The new
// key's allowlist holds only the root sentinel, as for every new org.
// Writes DEMO_PUBLIC_ORG_ID (and the org's token, which is never printed) to apps/server/.env. Restart the
// server afterwards; on a hosted server, set DEMO_PUBLIC_ORG_ID in its environment and point BOUND_API_URL at it.
// Usage: TEMPO_NETWORK=testnet tsx scripts/public-demo-org.ts [--replace | --env-out <file>]
import { txUrl } from '@bound/core'
import { assertTestnetChain, boundApi, createAuthorizedDemoOrg, demoRootClient, die, ensureFunded, requireTestnet, SERVER_ENV, setEnv } from './lib'

const { net, pub } = requireTestnet()
await assertTestnetChain(pub)

// --env-out <file>: write the new org's settings there instead of apps/server/.env (for a hosted server: this machine
// keeps its own public demo org, and the hosted one gets DEMO_PUBLIC_ORG_ID from that file)
const outIdx = process.argv.indexOf('--env-out')
const envOut = outIdx > 0 ? process.argv[outIdx + 1] : undefined
if (outIdx > 0 && !envOut) die('--env-out needs a file path')
const current = process.env.DEMO_PUBLIC_ORG_ID
if (!envOut && current && !process.argv.includes('--replace')) die(`DEMO_PUBLIC_ORG_ID is already set (${current}). Pass --replace to create a new public demo org.`)

const API = process.env.BOUND_API_URL || `http://localhost:${process.env.PORT || 8787}`
const api = boundApi(API)
const health = await api('GET', '/health').catch((e) => die(`server not reachable at ${API} (${(e as Error).message}); start it with \`pnpm --filter @bound/server dev\``))
if (health.network !== 'testnet') die(`server at ${API} runs on ${health.network}, expected testnet`)

const root = demoRootClient(net)
await assertTestnetChain(root)
await ensureFunded(pub, root.account.address, 'demo root') // it pays the authorization's fee

const org = await createAuthorizedDemoOrg(api, root, 'Northwind Trading (public demo)')
if (org.orgId === process.env.DEMO_ORG_ID) die('the new org has the filmed demo org id; nothing written') // cannot happen: ids are random
setEnv(envOut ?? SERVER_ENV, { DEMO_PUBLIC_ORG_ID: org.orgId, DEMO_PUBLIC_ORG_TOKEN: org.token, DEMO_PUBLIC_ORG_AUTHORIZE_TX: org.authTx })

console.log(`public demo org ${org.orgId} authorized: ${txUrl('testnet', org.authTx)}`)
console.log(`Wrote DEMO_PUBLIC_ORG_ID to ${envOut ?? 'apps/server/.env'} (its org token is stored there too, not printed). Set it on the server ${envOut ? 'at BOUND_API_URL ' : ''}and restart it so /try runs on it.`)
process.exit(0)
