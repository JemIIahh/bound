// Attack-lab "guard off" proof against Tempo Moderato TESTNET ONLY, with throwaway keys. Never point this at mainnet.
// Claim under test: with Bound's software checks OFF, a payment from the org's scoped agent key to an
// address outside its allowlist is still refused by Tempo, as a MINED, REVERTED transaction with a hash.
import { createClient, getAddress, http, publicActions, walletActions, type Address, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts'
import { Abis, Account } from 'viem/tempo'
import {
  agentAccount, buildAuthorizeKeyCall, forceSendWithKey, FORCE_SEND_GAS, getNetwork, memoFromInvoice, payWithKey,
  PaymentOutcomeUnknown, PaymentRejected, preflightPay, publicClientFor, readAllowlist, txUrl,
} from '../src/index'

const NET = 'testnet' as const
const net = getNetwork(NET)
if (net.chain.id !== 42431) throw new Error('testnet only')
const token = net.token
const pub = publicClientFor(NET)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const json = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x))
const hashes: [string, Hex][] = []
let failed = 0
const check = (name: string, cond: boolean, extra?: unknown) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`, extra !== undefined ? json(extra) : '')
  if (!cond) failed++
}

async function retry<T>(fn: () => Promise<T>, tries = 5): Promise<T> {
  let last: unknown
  for (let i = 0; i < tries; i++) {
    try { return await fn() } catch (e) { last = e; await sleep(1500 * (i + 1)) }
  }
  throw last
}

const rootPk = generatePrivateKey()
const agentPk = generatePrivateKey()
const payee = privateKeyToAddress(generatePrivateKey())    // the one approved recipient
const attacker = privateKeyToAddress(generatePrivateKey()) // the invoice's swapped-in address
const rootAccount = Account.fromSecp256k1(rootPk)
const root = rootAccount.address
const agent = agentAccount(agentPk, root)
const keyId = privateKeyToAddress(agentPk)
console.log(json({ root, keyId, payee, attacker }))

const rootClient = createClient({ account: rootAccount, chain: net.chain, transport: http(net.rpc) }).extend(publicActions).extend(walletActions)
const balanceOf = (a: Address) => pub.readContract({ address: token, abi: Abis.tip20, functionName: 'balanceOf', args: [a] }) as Promise<bigint>

// 1. fund root (HTTP faucet, then the tempo_fundAddress RPC as a fallback)
try {
  const res = await fetch('https://tempo.xyz/developers/api/faucet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: root }) })
  console.log('faucet', res.status, (await res.text()).slice(0, 160))
} catch (e) { console.log('faucet http failed', (e as Error).message) }
for (let i = 0; i < 15 && (await retry(() => balanceOf(root))) === 0n; i++) await sleep(2000)
if ((await retry(() => balanceOf(root))) === 0n) {
  try { console.log('tempo_fundAddress', json(await pub.request({ method: 'tempo_fundAddress' as any, params: [root] as any }))) } catch (e) { console.log('tempo_fundAddress failed', (e as Error).message) }
  for (let i = 0; i < 15 && (await retry(() => balanceOf(root))) === 0n; i++) await sleep(2000)
}
const funded = await retry(() => balanceOf(root))
if (funded === 0n) { console.log(`BLOCKED: root ${root} unfunded`); process.exit(2) }
console.log('root balance', funded)

// 2. authorize the agent key scoped to ONE recipient (payee), 5 pathUSD / hour
const expiry = BigInt(Math.floor(Date.now() / 1000) + 86400)
const authCall = buildAuthorizeKeyCall({ keyId, token, limit: 5_000_000n, periodSeconds: 3600n, expiry, recipients: [payee] })
// async send + receipt polling: the sync RPC variant can time out on a slow node even though the tx lands
const authHash = await rootClient.sendTransaction({ ...authCall } as any)
hashes.push(['authorizeKey [payee]', authHash])
const authRc = await pub.waitForTransactionReceipt({ hash: authHash, timeout: 120_000 })
check('2a authorizeKey mined', authRc.status === 'success', { status: authRc.status })
const list = await retry(() => readAllowlist(pub, { account: root, keyId, token }))
check('2 allowlist == [payee]', list.length === 1 && list[0] === getAddress(payee), list)

const amount = 1_000_000n
const memo = memoFromInvoice('INV-EVIL-1')

// 3. what Bound's preflight (estimateGas) says about the attacker address
const pf = await preflightPay(pub, { account: agent, token, to: attacker, amount, memo })
check('3 preflight(attacker) -> CallNotAllowed', !pf.ok && pf.code === 'CallNotAllowed', pf)
const pfOk = await preflightPay(pub, { account: agent, token, to: payee, amount, memo })
check('3b preflight(payee) ok', pfOk.ok, pfOk)

// 4. the pre-existing lab path: payWithKey with an explicit gas limit only
try {
  const r = await payWithKey({ network: NET, account: agent, token, to: attacker, amount, memo, gas: FORCE_SEND_GAS })
  hashes.push([`payWithKey(gas) -> ${r.status}`, r.txHash])
  console.log('4 payWithKey(gas) broadcast:', json(r))
} catch (e) {
  if (e instanceof PaymentOutcomeUnknown) hashes.push(['payWithKey(gas) outcome unknown', e.txHash])
  console.log(`4 payWithKey(gas) did NOT broadcast: ${(e as any).name} ${(e as PaymentRejected).code ?? ''} ${(e as Error).message.slice(0, 200)}`)
}

// 5. the lab forced send: no simulation at all
let forced: Awaited<ReturnType<typeof forceSendWithKey>> | null = null
try {
  forced = await forceSendWithKey({ network: NET, account: agent, token, to: attacker, amount, memo })
  hashes.push([`forceSendWithKey(attacker) -> ${forced.status}`, forced.txHash])
} catch (e) {
  if (e instanceof PaymentOutcomeUnknown) hashes.push(['forceSendWithKey(attacker) outcome unknown', e.txHash])
  console.log(`forceSendWithKey threw: ${(e as any).name} ${(e as PaymentRejected).code ?? ''} ${(e as Error).message.slice(0, 300)}`)
}
check('5a forced send to attacker was broadcast with a tx hash', !!forced?.txHash, forced)
check('5b precomputed hash == node hash', !!forced && forced.txHash === forced.receiptTxHash)
if (forced) {
  const rc = await retry(() => pub.getTransactionReceipt({ hash: forced!.txHash }))
  check('5c MINED and REVERTED', rc.status === 'reverted', { block: rc.blockNumber, status: rc.status, gasUsed: rc.gasUsed })
  console.log(`5d gasUsed by the keychain revert: ${rc.gasUsed} (limit ${FORCE_SEND_GAS})`)
}
check('5e attacker received nothing', (await retry(() => balanceOf(attacker))) === 0n)

// 6. control: the same forced path to the approved payee succeeds (proves the revert is Tempo's scope, not our tx)
try {
  const ok = await forceSendWithKey({ network: NET, account: agent, token, to: payee, amount, memo: memoFromInvoice('INV-OK-1') })
  hashes.push([`forceSendWithKey(payee) -> ${ok.status}`, ok.txHash])
  const rc = await retry(() => pub.getTransactionReceipt({ hash: ok.txHash }))
  check('6 forced send to approved payee succeeds', rc.status === 'success', { gasUsed: rc.gasUsed })
  console.log(`6b gasUsed by a successful transferWithMemo: ${rc.gasUsed}`)
} catch (e) {
  check('6 forced send to approved payee succeeds', false, (e as Error).message.slice(0, 300))
}
check('6c payee received 1 pathUSD', (await retry(() => balanceOf(payee))) === amount)

for (const [label, h] of hashes) console.log(`${label}: ${txUrl(NET, h)}`)
console.log(failed ? `FAILED checks: ${failed}` : 'ALL CHECKS PASSED')
process.exit(failed ? 1 : 0)
