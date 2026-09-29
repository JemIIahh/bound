import { parseAbi, type Address, type Hex, type PublicClient } from 'viem'

export const boundRegistryAbi = parseAbi([
  'struct Payee { string legalName; string domain; string lei; bytes4 masterId; uint8 level; uint64 verifiedAt; uint64 activeFrom; uint64 supersededAt; uint64 revokedAt; address successor; bytes32 evidenceHash; }',
  'function attest(address wallet, string legalName, string domain, string lei, bytes4 masterId, uint8 level, bytes32 evidenceHash)',
  'function supersede(address oldWallet, address newWallet, string legalName, string domain, string lei, bytes4 masterId, uint8 level, bytes32 evidenceHash)',
  'function revoke(address wallet, string reason)',
  'function getPayee(address wallet) view returns (Payee)',
  'function currentWalletForDomain(bytes32) view returns (address)',
  'function attester() view returns (address)',
  'event PayeeAttested(address indexed wallet, bytes32 indexed domainHash, string legalName, string domain, string lei, bytes4 masterId, uint8 level, uint64 activeFrom, bytes32 evidenceHash)',
  'event PayeeSuperseded(address indexed oldWallet, address indexed newWallet, uint64 activeFrom)',
  'event PayeeRevoked(address indexed wallet, string reason)',
])

export type OnchainPayee = {
  wallet: Address
  legalName: string
  domain: string
  lei: string
  masterId: Hex
  level: 1 | 2
  verifiedAt: number
  activeFrom: number
  supersededAt: number
  revokedAt: number
  successor: Address | null
  evidenceHash: Hex
}

const ZERO = '0x0000000000000000000000000000000000000000'

export async function readPayee(client: PublicClient, registry: Address, wallet: Address): Promise<OnchainPayee | null> {
  const p = await client.readContract({ address: registry, abi: boundRegistryAbi, functionName: 'getPayee', args: [wallet] })
  if (p.verifiedAt === 0n) return null
  return {
    wallet,
    legalName: p.legalName,
    domain: p.domain,
    lei: p.lei,
    masterId: p.masterId,
    level: p.level as 1 | 2,
    verifiedAt: Number(p.verifiedAt),
    activeFrom: Number(p.activeFrom),
    supersededAt: Number(p.supersededAt),
    revokedAt: Number(p.revokedAt),
    successor: p.successor === ZERO ? null : p.successor,
    evidenceHash: p.evidenceHash,
  }
}
