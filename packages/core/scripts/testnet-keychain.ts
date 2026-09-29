// Throwaway-keys integration check against Tempo Moderato TESTNET ONLY. Never point this at mainnet.
import { createClient, encodeFunctionData, getAddress, http, publicActions, walletActions, type Address, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts'
import { Abis, Account } from 'viem/tempo'
import {
  KEYCHAIN, TRANSFER_WITH_MEMO_SELECTOR, agentAccount, buildAuthorizeKeyCall, buildSetAllowlistCall, getNetwork,
  memoFromInvoice, payWithKey, preflightPay, publicClientFor, readAllowlist, txUrl, withRecipient,
} from '../src/index'

const NET = 'testnet' as const
const net = getNetwork(NET)
const token = net.token
const pub = publicClientFor(NET)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const hashes: [string, Hex][] = []
let failed = 0
const check = (name: string, cond: boolean, extra?: unknown) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`, extra !== undefined ? JSON.stringify(extra, (_, v) => (typeof v === 'bigint' ? v.toString() : v)) : '')
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
const payee = privateKeyToAddress(generatePrivateKey())
const stranger = privateKeyToAddress(generatePrivateKey())
const rootAccount = Account.fromSecp256k1(rootPk)
const root = rootAccount.address
const agent = agentAccount(agentPk, root)
const keyId = privateKeyToAddress(agentPk)
console.log({ root, keyId, payee, stranger })

const rootClient = createClient({ account: rootAccount, chain: net.chain, transport: http(net.rpc) }).extend(publicActions).extend(walletActions)
const balanceOf = (a: Address) => pub.readContract({ address: token, abi: Abis.tip20, functionName: 'balanceOf', args: [a] }) as Promise<bigint>

async function rootSend(label: string, call: { to: Address; data: Hex }) {
  try {
    const r: any = await rootClient.sendTransactionSync({ ...call, throwOnReceiptRevert: true } as any) // gas estimated by viem (authorizeKey needs ~3.6M)
    hashes.push([label, r.transactionHash])
    return r
  } catch (e) {
    console.log(`(send ${label} errored: ${(e as any).shortMessage ?? (e as Error).message}; checking state instead)`)
    return null
  }
}

// 1. fund root
try {
  const res = await fetch('https://tempo.xyz/developers/api/faucet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: root }) })
  console.log('faucet', res.status, (await res.text()).slice(0, 200))
} catch (e) { console.log('faucet http failed', (e as Error).message) }
for (let i = 0; i < 30 && (await retry(() => balanceOf(root))) === 0n; i++) await sleep(2000)
const funded = await retry(() => balanceOf(root))
if (funded === 0n) { console.log(`BLOCKED: root ${root} unfunded; fund via web faucet and rerun`); process.exit(2) }
console.log('root balance', funded)

// 2. authorize scoped key: recipients [root]
const expiry = BigInt(Math.floor(Date.now() / 1000) + 86400)
await rootSend('authorizeKey', buildAuthorizeKeyCall({ keyId, token, limit: 5_000_000n, periodSeconds: 3600n, expiry, recipients: [root] }))

// 3. allowlist == [root]
const list1 = await retry(() => readAllowlist(pub, { account: root, keyId, token }))
check('3 readAllowlist == [root]', list1.length === 1 && list1[0] === getAddress(root), list1)

// 4. preflight to payee blocked
const memo = memoFromInvoice('INV-TEST')
const pf1 = await preflightPay(pub, { account: agent, token, to: payee, amount: 1_000_000n, memo })
check('4 preflight payee -> CallNotAllowed', !pf1.ok && pf1.code === 'CallNotAllowed', pf1)

// 5. add payee, preflight ok, pay
await rootSend('setAllowedCalls[root,payee]', buildSetAllowlistCall({ keyId, token, recipients: withRecipient([root], payee) }))
const list2 = await retry(() => readAllowlist(pub, { account: root, keyId, token }))
check('5a allowlist has payee', list2.includes(getAddress(payee)), list2)
const pf2 = await preflightPay(pub, { account: agent, token, to: payee, amount: 1_000_000n, memo })
check('5b preflight payee ok', pf2.ok, pf2)
let payRes: Awaited<ReturnType<typeof payWithKey>> | null = null
try {
  payRes = await payWithKey({ network: NET, account: agent, token, to: payee, amount: 1_000_000n, memo })
  hashes.push(['payWithKey', payRes.txHash])
} catch (e) { console.log('payWithKey errored', (e as any).shortMessage ?? (e as Error).message) }
const payeeBal = await retry(() => balanceOf(payee))
check('5c payWithKey success', payRes?.status === 'success' || payeeBal === 1_000_000n, { payRes, payeeBal })

// 6. spending limit
const pf3 = await preflightPay(pub, { account: agent, token, to: payee, amount: 10_000_000n, memo })
check('6 preflight 10 pathUSD -> SpendingLimitExceeded', !pf3.ok && pf3.code === 'SpendingLimitExceeded', pf3)

// 7. empty-list probe (bypasses the builder on purpose; never used in product)
const emptyData = encodeFunctionData({
  abi: Abis.accountKeychain,
  functionName: 'setAllowedCalls',
  args: [keyId, [{ target: token, selectorRules: [{ selector: TRANSFER_WITH_MEMO_SELECTOR, recipients: [] }] }]] as any,
})
await rootSend('setAllowedCalls[] (probe)', { to: KEYCHAIN, data: emptyData })
const list3 = await retry(() => readAllowlist(pub, { account: root, keyId, token }))
const pf4 = await preflightPay(pub, { account: agent, token, to: stranger, amount: 1_000_000n, memo })
console.log('probe: allowlist after empty write =', list3, 'preflight to stranger =', JSON.stringify(pf4, (_, v) => (typeof v === 'bigint' ? v.toString() : v)))
console.log(`EMPTY_LIST_ALLOWS_ANYONE=${pf4.ok}`)

// 8. hashes
for (const [label, h] of hashes) console.log(`${label}: ${txUrl(NET, h)}`)
console.log(failed ? `FAILED checks: ${failed}` : 'ALL CHECKS PASSED')
process.exit(failed ? 1 : 0)
