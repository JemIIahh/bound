import { encodeFunctionData, getAddress, type Address, type Hex } from 'viem'
import type { ReadClient } from './networks'
import { Abis } from 'viem/tempo'
import { KEYCHAIN, MAX_RECIPIENTS, TRANSFER_WITH_MEMO_SELECTOR } from './constants'

export class AllowlistError extends Error {}

function assertList(recipients: Address[]): Address[] {
  if (recipients.length === 0) throw new AllowlistError('Recipient list must never be empty (an empty list may allow any recipient).')
  if (recipients.length > MAX_RECIPIENTS) throw new AllowlistError(`Tempo allows at most ${MAX_RECIPIENTS} recipients per key scope.`)
  return recipients.map((r) => getAddress(r))
}

export function withRecipient(list: Address[], add: Address): Address[] {
  const norm = list.map((r) => getAddress(r))
  const a = getAddress(add)
  if (norm.includes(a)) return norm
  if (norm.length >= MAX_RECIPIENTS) throw new AllowlistError(`Allowlist full: Tempo allows at most ${MAX_RECIPIENTS} recipients per key scope.`)
  return [...norm, a]
}

export function withoutRecipient(list: Address[], remove: Address): Address[] {
  const r = getAddress(remove)
  const next = list.map((x) => getAddress(x)).filter((x) => x !== r)
  if (next.length === 0) throw new AllowlistError('Refusing to remove the last recipient (an empty list may allow any recipient).')
  return next
}

function scope(token: Address, recipients: Address[]) {
  return { target: getAddress(token), selectorRules: [{ selector: TRANSFER_WITH_MEMO_SELECTOR, recipients }] }
}

export function buildAuthorizeKeyCall(p: { keyId: Address; token: Address; limit: bigint; periodSeconds: bigint; expiry: bigint; recipients: Address[] }): { to: Address; data: Hex } {
  const recipients = assertList(p.recipients)
  const config = {
    expiry: p.expiry,
    enforceLimits: true,
    limits: [{ token: getAddress(p.token), amount: p.limit, period: p.periodSeconds }],
    allowAnyCalls: false,
    allowedCalls: [scope(p.token, recipients)],
  }
  // signatureType 0 = secp256k1 (the agent key is a server-generated secp256k1 key)
  const data = encodeFunctionData({ abi: Abis.accountKeychain, functionName: 'authorizeKey', args: [getAddress(p.keyId), 0, config] as any })
  return { to: KEYCHAIN, data }
}

export function buildSetAllowlistCall(p: { keyId: Address; token: Address; recipients: Address[] }): { to: Address; data: Hex } {
  const recipients = assertList(p.recipients)
  const data = encodeFunctionData({ abi: Abis.accountKeychain, functionName: 'setAllowedCalls', args: [getAddress(p.keyId), [scope(p.token, recipients)]] as any })
  return { to: KEYCHAIN, data }
}

export async function readAllowlist(client: ReadClient, p: { account: Address; keyId: Address; token: Address }): Promise<Address[]> {
  const [isScoped, scopes] = (await client.readContract({ address: KEYCHAIN, abi: Abis.accountKeychain, functionName: 'getAllowedCalls', args: [p.account, p.keyId] })) as readonly [boolean, readonly { target: Address; selectorRules: readonly { selector: Hex; recipients: readonly Address[] }[] }[]]
  if (!isScoped) return []
  const s = scopes.find((x) => getAddress(x.target) === getAddress(p.token))
  const rule = s?.selectorRules.find((r) => r.selector.toLowerCase() === TRANSFER_WITH_MEMO_SELECTOR)
  return (rule?.recipients ?? []).map((r) => getAddress(r))
}

export async function readKey(client: ReadClient, account: Address, keyId: Address) {
  return client.readContract({ address: KEYCHAIN, abi: Abis.accountKeychain, functionName: 'getKey', args: [account, keyId] })
}
