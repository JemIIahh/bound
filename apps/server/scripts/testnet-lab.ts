// Attack-lab guard-off check through the SERVER lab path (guard_off tools → raw_transfer → ChainOps.send({ force })),
// against Tempo Moderato TESTNET ONLY with throwaway keys and an in-memory DB. Never point this at mainnet.
// Expected: the model-free tool call to an address outside the key's allowlist yields a MINED, REVERTED tx.
import { createClient, http, publicActions, walletActions, type Address } from 'viem'
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts'
import { Abis, Account } from 'viem/tempo'
import { eq } from 'drizzle-orm'
import { buildAuthorizeKeyCall, getNetwork, publicClientFor, txUrl } from '@bound/core'
import { createDb, migrate } from '../src/db/client'
import { events, invoices, orgs, payments } from '../src/db/schema'
import { encryptSecret } from '../src/crypto'
import { productionChainOps } from '../src/services/payments'
import { buildTools } from '../src/agent/tools'

const NET = 'testnet' as const
const net = getNetwork(NET)
if (net.chain.id !== 42431) throw new Error('testnet only')
const pub = publicClientFor(NET)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const balanceOf = (a: Address) => pub.readContract({ address: net.token, abi: Abis.tip20, functionName: 'balanceOf', args: [a] }) as Promise<bigint>

const secret = ('0x' + '5a'.repeat(32)) as `0x${string}`
const rootPk = generatePrivateKey()
const agentPk = generatePrivateKey()
const rootAccount = Account.fromSecp256k1(rootPk)
const root = rootAccount.address
const keyId = privateKeyToAddress(agentPk)
const payee = privateKeyToAddress(generatePrivateKey())
const attacker = privateKeyToAddress(generatePrivateKey())
console.log(JSON.stringify({ root, keyId, payee, attacker }))

// fund + authorize the agent key for ONE recipient (payee)
// the funding RPC can time out even though the funds land, so poll the balance either way
try { await pub.request({ method: 'tempo_fundAddress' as any, params: [root] as any }) } catch (e) { console.log('tempo_fundAddress:', (e as Error).message.split('\n')[0]) }
for (let i = 0; i < 30 && (await balanceOf(root).catch(() => 0n)) === 0n; i++) await sleep(2000)
if ((await balanceOf(root)) === 0n) { console.log('BLOCKED: root unfunded'); process.exit(2) }
const rootClient = createClient({ account: rootAccount, chain: net.chain, transport: http(net.rpc) }).extend(publicActions).extend(walletActions)
const authHash = await rootClient.sendTransaction({ ...buildAuthorizeKeyCall({ keyId, token: net.token, limit: 5_000_000n, periodSeconds: 3600n, expiry: BigInt(Math.floor(Date.now() / 1000) + 86400), recipients: [payee] }) } as any)
const authRc = await pub.waitForTransactionReceipt({ hash: authHash, timeout: 120_000 })
console.log('authorizeKey', authRc.status, txUrl(NET, authHash))

// server state: org with the encrypted scoped key, and a lab invoice
const db = createDb(':memory:'); migrate(db)
db.insert(orgs).values({ id: 'org1', name: 'Lab Buyer', rootAddress: root, agentKeyAddress: keyId, agentKeyEnc: encryptSecret(agentPk, secret), tokenHash: 'h', limitBase: '5000000', periodSeconds: 3600, authorized: 1, createdAt: 1 }).run()
db.insert(invoices).values({ id: 'inv1', orgId: 'org1', raw: 'lab', lab: 1, createdAt: 1 }).run()
const chain = { network: NET, token: net.token, pub } as any
const deps = { db, chain, config: { serverSecret: secret, registry: '0x0000000000000000000000000000000000000000' } as any, ops: productionChainOps({ db, chain, config: { serverSecret: secret } as any }) } as any

// exactly what the guard-off agent does: record the (attacker) fields, then raw_transfer
const tools = buildTools(deps, 'inv1', 'guard_off', (name, out) => console.log(`tool_result ${name}`, JSON.stringify(out)))
const tool = (name: string) => tools.find((t) => t.name === name) as any
await tool('record_invoice_fields').run({ payeeName: 'Acme Ltd', address: attacker, amount: '1.00', currency: 'USDC', invoiceNo: 'INV-EVIL-7' })
const out = JSON.parse(await tool('raw_transfer').run({ to: attacker, amount: '1.00', memo: 'INV-EVIL-7' }))

let failed = 0
const check = (name: string, ok: boolean, extra?: unknown) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`, extra !== undefined ? JSON.stringify(extra, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)) : ''); if (!ok) failed++ }
check('raw_transfer → chain rejected with CallNotAllowed and a tx hash', out.chain === 'rejected' && out.code === 'CallNotAllowed' && /^0x[0-9a-f]{64}$/.test(out.txHash), out)
if (out.txHash) {
  const rc = await pub.getTransactionReceipt({ hash: out.txHash })
  check('receipt: mined and reverted', rc.status === 'reverted', { block: rc.blockNumber, gasUsed: rc.gasUsed })
  console.log('explorer:', txUrl(NET, out.txHash))
}
check('attacker received nothing', (await balanceOf(attacker)) === 0n)
check('invoice blocked', db.select().from(invoices).where(eq(invoices.id, 'inv1')).get()?.status === 'blocked')
check('payment row reverted with the hash', db.select().from(payments).where(eq(payments.invoiceId, 'inv1')).get()?.txHash === out.txHash)
check('chain_rejected event', db.select().from(events).where(eq(events.kind, 'chain_rejected')).all().length === 1)

// the gate: a guard-off transfer Tempo WOULD accept (to the allowlisted payee) is never sent
db.insert(invoices).values({ id: 'inv2', orgId: 'org1', raw: 'lab', lab: 1, createdAt: 2 }).run()
const tools2 = buildTools(deps, 'inv2', 'guard_off', (name, o) => console.log(`tool_result ${name}`, JSON.stringify(o)))
const gated = JSON.parse(await (tools2.find((t) => t.name === 'raw_transfer') as any).run({ to: payee, amount: '1.00', memo: 'INV-OK-7' }))
check('gate: payable transfer is not sent', gated.chain === 'not_sent' && !gated.txHash, gated)
check('gate: payee received nothing', (await balanceOf(payee)) === 0n)
console.log(failed ? `FAILED checks: ${failed}` : 'ALL CHECKS PASSED')
process.exit(failed ? 1 : 0)
