// Creates apps/server/.env with fresh THROWAWAY testnet keys (only fills values that are missing).
// Prints addresses only. The demo root key is a demo-only stand-in for a customer's own root account.
// Usage: TEMPO_NETWORK=testnet tsx scripts/demo-keys.ts
import { randomBytes } from 'node:crypto'
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts'
import { requireTestnet, SERVER_ENV, setEnv } from './lib'

requireTestnet()

const KEYS = ['DEPLOYER_PRIVATE_KEY', 'ATTESTER_PRIVATE_KEY', 'DEMO_PAYEE_PRIVATE_KEY', 'DEMO_ROOT_PRIVATE_KEY'] as const
const updates: Record<string, string> = {}
const missing = (k: string) => !/^0x[0-9a-fA-F]{64}$/.test(process.env[k] ?? '')

updates.TEMPO_NETWORK = 'testnet'
for (const k of KEYS) if (missing(k)) updates[k] = generatePrivateKey()
updates.DEMO_PAYEE_ADDRESS = privateKeyToAddress((updates.DEMO_PAYEE_PRIVATE_KEY ?? process.env.DEMO_PAYEE_PRIVATE_KEY) as `0x${string}`)
if (missing('SERVER_SECRET')) updates.SERVER_SECRET = `0x${randomBytes(32).toString('hex')}`
// A wallet nobody registered (its key is discarded): the lab's "unknown address" case.
if (!/^0x[0-9a-fA-F]{40}$/.test(process.env.LAB_UNREGISTERED_ADDRESS ?? '')) updates.LAB_UNREGISTERED_ADDRESS = privateKeyToAddress(generatePrivateKey())
if (!process.env.DATABASE_PATH) updates.DATABASE_PATH = './bound.db'
if (!process.env.PORT) updates.PORT = '8787'
if (!process.env.WEB_ORIGIN) updates.WEB_ORIGIN = 'http://localhost:3000'

setEnv(SERVER_ENV, updates, '# Bound demo (Tempo TESTNET). Throwaway keys, git-ignored: never commit this file.')
const e = process.env
const addr = (k: (typeof KEYS)[number]) => privateKeyToAddress(e[k] as `0x${string}`)
console.log(JSON.stringify({
  wrote: Object.keys(updates),
  deployer: addr('DEPLOYER_PRIVATE_KEY'),
  attester: addr('ATTESTER_PRIVATE_KEY'),
  demoPayee: addr('DEMO_PAYEE_PRIVATE_KEY'),
  demoRoot: addr('DEMO_ROOT_PRIVATE_KEY'),
  unregistered: e.LAB_UNREGISTERED_ADDRESS,
}, null, 2))
