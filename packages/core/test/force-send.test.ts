import { describe, expect, test } from 'vitest'
import { createClient, custom, publicActions, walletActions, type Hex } from 'viem'
import { generatePrivateKey } from 'viem/accounts'
import { Transaction } from 'viem/tempo'
import { agentAccount, forceSendWithKey, FORCE_SEND_GAS, PaymentRejected } from '../src/tempo/pay'
import { getNetwork } from '../src/tempo/networks'

const root = '0x3333333333333333333333333333333333333333'
const attacker = '0x7777777777777777777777777777777777777777'
const memo = ('0x' + '11'.repeat(32)) as Hex
const H = (n: number) => ('0x' + n.toString(16)) as Hex
const ZERO32 = ('0x' + '00'.repeat(32)) as Hex

/** A viem client on a Tempo chain whose transport records every RPC method and serves canned answers. */
function recordingClient(network: 'testnet' | 'mainnet' = 'testnet') {
  const calls: { method: string; params: any }[] = []
  const net = getNetwork(network)
  const account = agentAccount(generatePrivateKey(), root)
  const transport = custom({
    async request({ method, params }: { method: string; params: any }) {
      calls.push({ method, params })
      switch (method) {
        case 'eth_chainId': return H(net.chain.id)
        case 'eth_getTransactionCount': return H(7)
        case 'eth_maxPriorityFeePerGas': return H(1)
        case 'eth_gasPrice': return H(20_000_000_000)
        case 'eth_getBlockByNumber': return {
          number: H(100), hash: ZERO32, parentHash: ZERO32, timestamp: H(1), baseFeePerGas: H(10_000_000_000),
          gasLimit: H(30_000_000), gasUsed: H(0), transactions: [], miner: root, difficulty: H(0), extraData: '0x',
          logsBloom: '0x' + '00'.repeat(256), nonce: '0x0000000000000000', sha3Uncles: ZERO32, size: H(1), stateRoot: ZERO32,
          receiptsRoot: ZERO32, transactionsRoot: ZERO32, uncles: [], mixHash: ZERO32,
        }
        case 'eth_sendRawTransactionSync': return {
          transactionHash: ZERO32, status: '0x0', blockNumber: H(101), blockHash: ZERO32, gasUsed: H(37_444),
          cumulativeGasUsed: H(37_444), effectiveGasPrice: H(10_000_000_000), logs: [], from: root, to: net.token,
          transactionIndex: '0x0', type: '0x76', contractAddress: null, logsBloom: '0x' + '00'.repeat(256),
        }
        default: throw new Error(`unexpected RPC ${method}`)
      }
    },
  })
  const client = createClient({ account, chain: net.chain, transport }).extend(publicActions).extend(walletActions)
  return { client, calls, account, net }
}

/** A Tempo client whose transport records and then throws on every RPC call (never touches a network). */
function throwingClient(network: 'testnet' | 'mainnet') {
  const calls: string[] = []
  const net = getNetwork(network)
  const account = agentAccount(generatePrivateKey(), root)
  const transport = custom({ async request({ method }: { method: string }) { calls.push(method); throw new Error(`network access in test: ${method}`) } })
  const client = createClient({ account, chain: net.chain, transport }).extend(publicActions).extend(walletActions)
  return { client, calls, account }
}

const params = (account: ReturnType<typeof agentAccount>, network: 'testnet' | 'mainnet' = 'testnet') =>
  ({ network, account, token: getNetwork(network).token, to: attacker, amount: 1_000_000n, memo }) as const

describe('forceSendWithKey', () => {
  test('pins nonce, gas, both fee fields, chain id and fee token, and never simulates', async () => {
    const { client, calls, account, net } = recordingClient()
    const r = await forceSendWithKey(params(account), { client: client as any })
    expect(r.status).toBe('reverted')
    const methods = calls.map((c) => c.method)
    expect(methods).not.toContain('eth_estimateGas')
    expect(methods).not.toContain('eth_fillTransaction')
    expect(methods).not.toContain('eth_call')
    expect(methods).toContain('eth_sendRawTransactionSync')
    const serialized = calls.find((c) => c.method === 'eth_sendRawTransactionSync')!.params[0] as Hex
    const tx: any = Transaction.deserialize(serialized as any)
    expect(tx.chainId).toBe(net.chain.id)
    expect(tx.nonce).toBe(7)
    expect(tx.gas).toBe(FORCE_SEND_GAS)
    expect(typeof tx.maxFeePerGas).toBe('bigint')
    expect(tx.maxFeePerGas > 0n).toBe(true)
    expect(typeof tx.maxPriorityFeePerGas).toBe('bigint')
    expect(tx.feeToken?.toLowerCase()).toBe(net.token.toLowerCase())
    expect(tx.calls?.[0]?.to?.toLowerCase() ?? tx.to?.toLowerCase()).toBe(net.token.toLowerCase())
  })

  test('refuses Tempo mainnet (4217) unless explicitly allowed, before any RPC', async () => {
    // a client whose transport throws on ANY call: even if the guard regressed, nothing can reach a real network
    const { client, calls, account } = throwingClient('mainnet')
    const err = await forceSendWithKey(params(account, 'mainnet'), { client: client as any }).catch((e) => e)
    expect(err).toBeInstanceOf(PaymentRejected)
    expect(err.message).toMatch(/mainnet/i)
    expect(calls).toHaveLength(0)
    const explicitFalse = await forceSendWithKey(params(account, 'mainnet'), { client: client as any, allowMainnet: false }).catch((e) => e)
    expect(explicitFalse).toBeInstanceOf(PaymentRejected)
    expect(explicitFalse.message).toMatch(/mainnet/i)
    expect(calls).toHaveLength(0)
  })

  test('mainnet is only reachable with allowMainnet', async () => {
    const { client, calls, account } = recordingClient('mainnet')
    const r = await forceSendWithKey(params(account, 'mainnet'), { client: client as any, allowMainnet: true })
    expect(r.status).toBe('reverted')
    expect(calls.map((c) => c.method)).toContain('eth_sendRawTransactionSync')
  })

  test('refuses a client whose chain does not match the requested network', async () => {
    const { client, calls, account } = recordingClient('mainnet')
    await expect(forceSendWithKey(params(account, 'testnet'), { client: client as any, allowMainnet: true })).rejects.toBeInstanceOf(PaymentRejected)
    expect(calls).toHaveLength(0)
  })
})
