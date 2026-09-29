import { createClient, encodeFunctionData, http, keccak256, publicActions, walletActions, type Address, type Hex } from 'viem'
import { Abis, Account } from 'viem/tempo'
import { decodeTempoError, type TempoErrorCode } from './errors'
import { getNetwork, type EstimateClient, type NetworkName } from './networks'

const TEMPO_CHAIN_IDS = [4217, 42431]

export function assertTempoClient(client: { chain?: { id: number } | null }): void {
  const id = client.chain?.id
  if (id === undefined || !TEMPO_CHAIN_IDS.includes(id)) {
    throw new Error(`Refusing to run: client is not a Tempo client (chain id ${id ?? 'none'}; expected ${TEMPO_CHAIN_IDS.join(' or ')}).`)
  }
}

/** Thrown when a failure happens before the transaction was broadcast (nothing was sent). */
export class PaymentRejected extends Error {
  code: TempoErrorCode
  constructor(code: TempoErrorCode, message: string) {
    super(message)
    this.name = 'PaymentRejected'
    this.code = code
  }
}

/** Thrown when broadcasting began but the outcome is unknown; txHash lets the caller check state. */
export class PaymentOutcomeUnknown extends Error {
  constructor(public txHash: Hex, cause: unknown) {
    super(`Payment outcome unknown for ${txHash}: ${(cause as any)?.shortMessage ?? (cause as Error)?.message ?? String(cause)}`, { cause })
    this.name = 'PaymentOutcomeUnknown'
  }
}

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
  assertTempoClient(client)
  try {
    const gas = await client.estimateGas({ account: p.account, to: p.token, data: transferData(p.to, p.amount, p.memo) })
    return { ok: true, gas }
  } catch (e) {
    return { ok: false, ...decodeTempoError(e) }
  }
}

/**
 * Sends transferWithMemo signed by the agent's access key. The tx hash is computed from the signed
 * bytes before broadcast so it is never lost. With `gas` set, estimation is skipped (lab "guard off" only).
 * Throws PaymentRejected (nothing sent) or PaymentOutcomeUnknown (broadcast began; check txHash).
 * `receiptTxHash` is the hash the node reported, exposed so callers/tests can confirm it equals `txHash`.
 */
export async function payWithKey(p: { network: NetworkName; account: AgentAccount; token: Address; to: Address; amount: bigint; memo: Hex; gas?: bigint }): Promise<{ txHash: Hex; receiptTxHash: Hex; status: 'success' | 'reverted'; error?: { code: TempoErrorCode; message: string } }> {
  const client = clientFor(p.network, p.account)
  assertTempoClient(client)
  let serialized: Hex
  try {
    const request: any = await client.prepareTransactionRequest({ account: p.account, to: p.token, data: transferData(p.to, p.amount, p.memo), ...(p.gas ? { gas: p.gas } : {}) } as any)
    serialized = (await client.signTransaction(request)) as Hex
  } catch (e) {
    const d = decodeTempoError(e)
    throw new PaymentRejected(d.code, d.message)
  }
  const txHash = keccak256(serialized)
  let receipt: any
  try {
    receipt = await client.sendRawTransactionSync({ serializedTransaction: serialized } as any)
  } catch (e) {
    throw new PaymentOutcomeUnknown(txHash, e)
  }
  return fromReceipt(txHash, receipt)
}

function fromReceipt(txHash: Hex, receipt: any) {
  const status: 'success' | 'reverted' = receipt.status === 'success' ? 'success' : 'reverted'
  return {
    txHash,
    receiptTxHash: receipt.transactionHash as Hex,
    status,
    ...(status === 'reverted' ? { error: { code: 'Other' as TempoErrorCode, message: 'Reverted onchain; reason not in receipt — see preflight' } } : {}),
  }
}

/**
 * Gas limit for forced (lab) sends. Measured on Moderato: a keychain-rejected transferWithMemo uses
 * 37,444 gas; a successful one to a fresh account 301,414 (estimate 318,432). 1M leaves >3x headroom.
 */
export const FORCE_SEND_GAS = 1_000_000n

/**
 * ATTACK LAB ONLY ("guard off"). Signs transferWithMemo with the access key and broadcasts it with NO
 * simulation: chain id, nonce, fees and gas are all set explicitly, so viem runs neither estimateGas
 * (which refuses a keychain-violating call before broadcast, i.e. no tx hash) nor eth_fillTransaction
 * (whose simulation is up to the node). Tempo then enforces the key's scope at execution: a payment to
 * a recipient outside the allowlist is MINED and REVERTS, leaving a public tx hash (proved on Moderato
 * by scripts/testnet-guard-off.ts). Never use this for real payments.
 * Throws PaymentRejected (nothing sent) or PaymentOutcomeUnknown (broadcast began; check txHash).
 */
export async function forceSendWithKey(p: { network: NetworkName; account: AgentAccount; token: Address; to: Address; amount: bigint; memo: Hex; gas?: bigint }): Promise<Awaited<ReturnType<typeof payWithKey>>> {
  const client = clientFor(p.network, p.account)
  assertTempoClient(client)
  let serialized: Hex
  try {
    const [nonce, fees] = await Promise.all([
      client.getTransactionCount({ address: p.account.address, blockTag: 'pending' }),
      client.estimateFeesPerGas(),
    ])
    const request: any = await client.prepareTransactionRequest({
      account: p.account,
      to: p.token,
      data: transferData(p.to, p.amount, p.memo),
      chainId: client.chain.id,
      nonce,
      gas: p.gas ?? FORCE_SEND_GAS,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      feeToken: p.token,
    } as any)
    serialized = (await client.signTransaction(request)) as Hex
  } catch (e) {
    const d = decodeTempoError(e)
    throw new PaymentRejected(d.code, d.message)
  }
  const txHash = keccak256(serialized)
  let receipt: any
  try {
    receipt = await client.sendRawTransactionSync({ serializedTransaction: serialized } as any)
  } catch (e) {
    throw new PaymentOutcomeUnknown(txHash, e)
  }
  return fromReceipt(txHash, receipt)
}
