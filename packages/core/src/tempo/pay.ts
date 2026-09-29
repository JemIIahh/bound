import { createClient, encodeFunctionData, http, publicActions, walletActions, type Address, type Hex } from 'viem'
import { Abis, Account } from 'viem/tempo'
import { decodeTempoError, type TempoErrorCode } from './errors'
import { getNetwork, type EstimateClient, type NetworkName } from './networks'

export function agentAccount(privateKey: Hex, root: Address) {
  return Account.fromSecp256k1(privateKey, { access: root })
}

type AgentAccount = ReturnType<typeof agentAccount>

function clientFor(network: NetworkName, account: AgentAccount) {
  const n = getNetwork(network)
  return createClient({ account, chain: n.chain, transport: http(n.rpc) }).extend(publicActions).extend(walletActions)
}

const transferData = (to: Address, amount: bigint, memo: Hex) =>
  encodeFunctionData({ abi: Abis.tip20, functionName: 'transferWithMemo', args: [to, amount, memo] })

/** Dry-run (estimateGas) of transferWithMemo as the agent's access key. Keychain rules are enforced at estimation. */
export async function preflightPay(
  client: EstimateClient,
  p: { account: AgentAccount; token: Address; to: Address; amount: bigint; memo: Hex },
): Promise<{ ok: true; gas: bigint } | { ok: false; code: TempoErrorCode; message: string }> {
  try {
    const gas = await client.estimateGas({ account: p.account, to: p.token, data: transferData(p.to, p.amount, p.memo) } as any)
    return { ok: true, gas }
  } catch (e) {
    return { ok: false, ...decodeTempoError(e) }
  }
}

/** Sends transferWithMemo signed by the agent's access key. With `gas` set, sends even if a preflight would fail (lab "guard off" only). */
export async function payWithKey(p: { network: NetworkName; account: AgentAccount; token: Address; to: Address; amount: bigint; memo: Hex; gas?: bigint }): Promise<{ txHash: Hex; status: 'success' | 'reverted'; error?: { code: TempoErrorCode; message: string } }> {
  const client = clientFor(p.network, p.account)
  const receipt: any = await client.sendTransactionSync({ to: p.token, data: transferData(p.to, p.amount, p.memo), gas: p.gas, throwOnReceiptRevert: false } as any)
  const status = receipt.status === 'success' ? 'success' : 'reverted'
  return { txHash: receipt.transactionHash, status, ...(status === 'reverted' ? { error: { code: 'CallNotAllowed' as TempoErrorCode, message: 'Reverted onchain' } } : {}) }
}
