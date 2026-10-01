// Seeds the TESTNET demo (Moderato, chain 42431), idempotently:
//  1. attests the demo payee "Acme Ltd" (wallet of DEMO_PAYEE_PRIVATE_KEY) at level 1, directly via the
//     attester (domain = DEMO_PAYEE_DOMAIN, else acme.example; a new domain re-attests in place);
//  2. funds the demo org root (DEMO_ROOT_PRIVATE_KEY) with test pathUSD from the faucet;
//  3. creates the demo org through the server's own services (createOrg) with that root and a 50 USD/day
//     limit, and authorizes its agent key by signing the authorizeCall with the demo root (authorizeDemo).
// Prints the org id and org token (a demo credential) and writes them to apps/server/.env.
// DEMO_ROOT_PRIVATE_KEY stands in for a customer's own root account and exists for the demo only.
// Usage: TEMPO_NETWORK=testnet tsx scripts/seed-demo.ts
import { getAddress, keccak256, stringToHex, zeroAddress, type Address } from 'viem'
import { privateKeyToAddress } from 'viem/accounts'
import { eq } from 'drizzle-orm'
import { addressUrl, boundRegistryAbi, normalizeDomain, readPayee, txUrl } from '@bound/core'
import { assertTestnetChain, DEMO_LIMIT_USD, DEMO_PERIOD_SECONDS, die, ensureFunded, needKey, requireTestnet, SERVER_ENV, setEnv, writeWebEnv } from './lib'

const { pub } = requireTestnet()
await assertTestnetChain(pub)

// server modules read apps/server/.env through loadConfig (lib.ts already loaded it)
const { loadConfig } = await import('../src/config')
const { createDb, migrate } = await import('../src/db/client')
const { createChain } = await import('../src/chain')
const { orgs } = await import('../src/db/schema')
const { productionChainOps } = await import('../src/services/payments')
const { authorizeDemo, createOrg } = await import('../src/services/orgs')

const config = loadConfig()
if (config.network !== 'testnet') die('config.network must be testnet')
const db = createDb(config.databasePath)
migrate(db)
const chain = createChain(config)
await assertTestnetChain(chain.attester)
const base = { db, chain, config }
const deps = { ...base, ops: productionChainOps(base) }

const PAYEE_NAME = 'Acme Ltd'
const domain = normalizeDomain(process.env.DEMO_PAYEE_DOMAIN || 'acme.example')
const payee = privateKeyToAddress(needKey('DEMO_PAYEE_PRIVATE_KEY'))
const demoRoot = privateKeyToAddress(needKey('DEMO_ROOT_PRIVATE_KEY'))
const registry = config.registry

// 1. payee attestation (level 1: wallet + domain)
const current = await readPayee(pub as any, registry, payee)
if (current && current.legalName === PAYEE_NAME && current.domain === domain && !current.supersededAt && !current.revokedAt) {
  console.log(`payee already attested: ${PAYEE_NAME} ${payee} (${domain})`)
} else {
  if (current && (current.supersededAt || current.revokedAt)) die(`payee ${payee} was superseded/revoked in this registry`)
  const holder = await pub.readContract({ address: registry, abi: boundRegistryAbi, functionName: 'currentWalletForDomain', args: [keccak256(stringToHex(domain))] })
  if (getAddress(holder) !== zeroAddress && getAddress(holder) !== payee) die(`${domain} is already held by ${holder} in this registry`)
  await ensureFunded(pub, chain.attester.account.address, 'attester')
  const evidence = keccak256(stringToHex(JSON.stringify({ demo: true, legalName: PAYEE_NAME, domain, wallet: payee })))
  const rc = await chain.attester.writeContractSync({ address: registry, abi: boundRegistryAbi, functionName: 'attest', args: [payee, PAYEE_NAME, domain, '', '0x00000000', 1, evidence] })
  if (rc.status !== 'success') die(`attest reverted: ${rc.transactionHash}`)
  console.log(`attested ${PAYEE_NAME} ${payee} (${domain}) level 1: ${txUrl('testnet', rc.transactionHash)}`)
  setEnv(SERVER_ENV, { DEMO_PAYEE_ATTEST_TX: rc.transactionHash })
}
setEnv(SERVER_ENV, { DEMO_PAYEE_NAME: PAYEE_NAME, DEMO_PAYEE_ADDRESS: payee, DEMO_PAYEE_DOMAIN_ATTESTED: domain })

// 2. the demo root pays invoices (through its scoped agent key) and the fees of its own key updates
await ensureFunded(pub, demoRoot, 'demo root')

// 3. demo org via the server's services
const LIMIT_USD = DEMO_LIMIT_USD // the server-side demo signer refuses anything above 50 USD per period
const PERIOD_SECONDS = DEMO_PERIOD_SECONDS
let orgId = process.env.DEMO_ORG_ID
let token = process.env.DEMO_ORG_TOKEN
const existing = orgId ? db.select().from(orgs).where(eq(orgs.id, orgId)).get() : undefined
if (!existing || !token) {
  const created = await createOrg(deps, { name: 'Northwind Trading (demo)', rootAddress: demoRoot as Address, limitUsd: LIMIT_USD, periodSeconds: PERIOD_SECONDS })
  orgId = created.org.id
  token = created.token
  setEnv(SERVER_ENV, { DEMO_ORG_ID: orgId, DEMO_ORG_TOKEN: token })
  console.log(`created org ${orgId} (agent key ${created.org.agentKeyAddress}, limit ${LIMIT_USD} USD/day)`)
} else {
  console.log(`org ${orgId} already exists`)
}
// the seed decides which org is the demo org (a DEMO_ORG_ID loaded from a previous seed may be stale)
const auth = await authorizeDemo({ ...deps, config: { ...config, demoOrgId: orgId! } }, orgId!)
const org = db.select().from(orgs).where(eq(orgs.id, orgId!)).get()!
if (!auth.authorized || !org.authorized) die('agent key authorization did not confirm')
setEnv(SERVER_ENV, { DEMO_ORG_AUTHORIZE_TX: org.authorizeTx ?? '' })
writeWebEnv()

console.log(JSON.stringify({
  registry: addressUrl('testnet', registry),
  payee: { name: PAYEE_NAME, wallet: payee, domain, explorer: addressUrl('testnet', payee) },
  org: { id: orgId, token, root: demoRoot, agentKey: org.agentKeyAddress, authorizeTx: org.authorizeTx ? txUrl('testnet', org.authorizeTx as `0x${string}`) : null },
}, null, 2))
process.exit(0)
