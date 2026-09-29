import { keccak256, stringToHex, getAddress, zeroAddress, type Address, type Hex } from 'viem'
import { Abis } from 'viem/tempo'
import { and, eq } from 'drizzle-orm'
import { ADDRESS_REGISTRY, boundRegistryAbi, compareNames, normalizeDomain, readPayee } from '@bound/core'
import { HttpError, type AppDeps } from '../app'
import type { Db } from '../db/client'
import { payees, type payeeVerifications } from '../db/schema'
import { resolveTxt } from './dns'
import { lookupLei } from './gleif'
import { mineSalt } from './salt-miner'

export type PayeeVerificationRow = typeof payeeVerifications.$inferSelect

/** External effects of the payee-verification flow, injected so the routes can be tested offline. */
export type PayeeServices = {
  resolveTxt: (name: string) => Promise<string[]>
  lookupLei: (lei: string) => Promise<{ legalName: string; status: string } | null>
  writeAttestation: (row: PayeeVerificationRow, level: 1 | 2) => Promise<{ txHash: Hex; action: 'attest' | 'supersede' }>
  /** TIP-1022 salt search for `wallet` (CPU-heavy). The router schedules it on a one-at-a-time queue. */
  mineSalt: (wallet: Address) => Promise<{ salt: Hex; masterId: Hex }>
  /** True iff the TIP-1022 registry maps `masterId` to `wallet`. `txHash`, when given, is awaited first. */
  checkMaster: (masterId: Hex, wallet: Address, txHash?: Hex) => Promise<boolean>
}

const NO_MASTER = '0x00000000' as Hex

/**
 * Name squatting: a current registry payee (not superseded or revoked) of ANOTHER company (other wallet
 * and other domain) already verified under this legal name, exactly or with look-alike characters.
 * Only an LEI-verified (level 2) attestation may then claim the same name. Reads the local registry mirror.
 */
export function registeredNameHolder(db: Db, row: Pick<PayeeVerificationRow, 'legalName' | 'wallet' | 'domain'>) {
  const wallet = getAddress(row.wallet)
  const domain = normalizeDomain(row.domain)
  const current = db.select().from(payees).where(and(eq(payees.supersededAt, 0), eq(payees.revokedAt, 0))).all()
  return current.find((p) => {
    if (getAddress(p.wallet) === wallet || normalizeDomain(p.domain) === domain) return false
    const n = compareNames(row.legalName, p.legalName)
    return n.result === 'MATCH' || (n.homoglyph && n.result === 'CLOSE_MATCH')
  }) ?? null
}

/**
 * LEI reuse: a current registry payee (not superseded or revoked) of ANOTHER company (other wallet and
 * other domain) already holds this LEI. The same wallet (re-attest) or the same domain (wallet rotation)
 * may reuse it. Reads the local registry mirror.
 */
export function registeredLeiHolder(db: Db, row: Pick<PayeeVerificationRow, 'lei' | 'wallet' | 'domain'>) {
  const lei = row.lei.trim().toUpperCase()
  if (!lei) return null
  const wallet = getAddress(row.wallet)
  const domain = normalizeDomain(row.domain)
  const current = db.select().from(payees).where(and(eq(payees.supersededAt, 0), eq(payees.revokedAt, 0))).all()
  return current.find((p) =>
    p.lei.trim().toUpperCase() === lei && getAddress(p.wallet) !== wallet && normalizeDomain(p.domain) !== domain,
  ) ?? null
}

export const WALLET_OTHER_DOMAIN = 'This wallet is already verified for another domain — use a new wallet to change domains'

/**
 * Wallet re-pointing: this wallet is already a current registry payee (not superseded or revoked) under
 * ANOTHER domain. BoundRegistry keeps a wallet's activeFrom on re-attest, so moving it to a new domain would
 * give that domain the wallet's old age (and let a lookalike look older than the real company). Only a
 * same-domain re-attest (e.g. a level 1 → 2 upgrade) is allowed. Reads the local registry mirror.
 */
export function walletVerifiedForOtherDomain(db: Db, row: Pick<PayeeVerificationRow, 'wallet' | 'domain'>) {
  const wallet = getAddress(row.wallet)
  const domain = normalizeDomain(row.domain)
  const current = db.select().from(payees).where(and(eq(payees.supersededAt, 0), eq(payees.revokedAt, 0))).all()
  return current.find((p) => getAddress(p.wallet) === wallet && normalizeDomain(p.domain) !== domain) ?? null
}

export function productionPayeeServices(deps: AppDeps): PayeeServices {
  const { chain, config } = deps
  const pub = chain.pub
  // core readPayee takes viem's plain PublicClient; the Tempo-chain client is structurally compatible at runtime.
  const payeeAt = (wallet: Address) => readPayee(pub as any, config.registry, wallet)

  return {
    resolveTxt,
    lookupLei,
    mineSalt,

    /**
     * Writes the payee to BoundRegistry, choosing the call the contract will accept:
     * - domain unheld, or held by this wallet → attest (a re-attest updates in place)
     * - domain held by another current wallet and this wallet is unverified → supersede(holder, wallet)
     * Anything the contract would revert on (DomainTaken, AlreadyVerified, AlreadySuperseded,
     * PayeeRevoked_) is surfaced as a 409 before a transaction is sent.
     */
    async writeAttestation(row, level) {
      const wallet = getAddress(row.wallet)
      // Attest exactly the domain that was signed and proven in DNS. It was stored as a normalizeDomain
      // fixed point (the contract hashes raw bytes); never re-normalize here, or the proven and attested
      // domains could differ.
      const domain = row.domain
      if (normalizeDomain(domain) !== domain) throw new Error(`Stored domain "${domain}" is not in normal form; refusing to attest`)
      const [holderRaw, self] = await Promise.all([
        pub.readContract({ address: config.registry, abi: boundRegistryAbi, functionName: 'currentWalletForDomain', args: [keccak256(stringToHex(domain))] }),
        payeeAt(wallet),
      ])
      if (self && (self.supersededAt || self.revokedAt)) throw new HttpError(409, 'Wallet has been superseded or revoked in the registry')

      const holder = getAddress(holderRaw)
      let action: 'attest' | 'supersede' = 'attest'
      if (holder !== zeroAddress && holder !== wallet) {
        const held = await payeeAt(holder)
        const holderIsCurrent = !!held && !held.supersededAt && !held.revokedAt
        // supersede needs an unverified new wallet; attest would revert DomainTaken.
        if (!holderIsCurrent || self) throw new HttpError(409, 'Domain already verified by another wallet')
        action = 'supersede'
      }
      // A re-attest keeps the wallet's activeFrom: never move a verified wallet to another domain (see walletVerifiedForOtherDomain).
      if (self && normalizeDomain(self.domain) !== domain) throw new HttpError(409, WALLET_OTHER_DOMAIN)

      const lei = row.leiVerified ? row.lei : '' // the registry stores an LEI only when it was verified
      const masterId = row.masterStatus === 'registered' && row.masterId ? (row.masterId as Hex) : NO_MASTER
      const evidence = keccak256(stringToHex(JSON.stringify({ id: row.id, sig: row.signature, dns: row.dnsVerified, lei: row.leiRecordJson })))
      const receipt = action === 'supersede'
        ? await chain.attester.writeContractSync({ address: config.registry, abi: boundRegistryAbi, functionName: 'supersede', args: [holder, wallet, row.legalName, domain, lei, masterId, level, evidence] })
        : await chain.attester.writeContractSync({ address: config.registry, abi: boundRegistryAbi, functionName: 'attest', args: [wallet, row.legalName, domain, lei, masterId, level, evidence] })
      if (receipt.status !== 'success') throw new Error(`Attestation reverted (${receipt.transactionHash})`)
      return { txHash: receipt.transactionHash, action }
    },

    async checkMaster(masterId, wallet, txHash) {
      if (txHash) await pub.waitForTransactionReceipt({ hash: txHash, timeout: 20_000 }).catch(() => null)
      const m = await pub.readContract({ address: ADDRESS_REGISTRY, abi: Abis.addressRegistry, functionName: 'getMaster', args: [masterId] })
      return getAddress(m) === getAddress(wallet)
    },
  }
}
