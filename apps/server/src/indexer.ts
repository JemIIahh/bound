import { getAddress, type Address, type PublicClient } from 'viem'
import { eq, and } from 'drizzle-orm'
import { boundRegistryAbi } from '@bound/core'
import type { Db } from './db/client'
import { events, indexerState, payees, pins } from './db/schema'
import { newId } from './crypto'

type RegistryLog = { eventName: string; args: any; blockNumber: bigint }

export function applyRegistryLog(db: Db, log: RegistryLog) {
  const now = Math.floor(Date.now() / 1000)
  const block = Number(log.blockNumber)
  if (log.eventName === 'PayeeAttested') {
    const a = log.args
    const wallet = getAddress(a.wallet)
    const row = { wallet, legalName: a.legalName, domain: a.domain, lei: a.lei, masterId: a.masterId, level: Number(a.level), activeFrom: Number(a.activeFrom), evidenceHash: a.evidenceHash, updatedBlock: block }
    db.insert(payees).values(row).onConflictDoUpdate({ target: payees.wallet, set: row }).run()
  } else if (log.eventName === 'PayeeSuperseded') {
    const oldWallet = getAddress(log.args.oldWallet)
    const successor = getAddress(log.args.newWallet)
    db.update(payees).set({ supersededAt: now, successor, updatedBlock: block }).where(eq(payees.wallet, oldWallet)).run()
    const pinned = db.select().from(pins).where(and(eq(pins.wallet, oldWallet), eq(pins.active, 1))).all()
    for (const p of pinned) {
      db.insert(events).values({ id: newId('ev'), orgId: p.orgId, kind: 'changed_alert', detailJson: JSON.stringify({ oldWallet, newWallet: successor, label: p.label, activeFrom: Number(log.args.activeFrom) }), createdAt: now }).run()
    }
  } else if (log.eventName === 'PayeeRevoked') {
    db.update(payees).set({ revokedAt: now, updatedBlock: block }).where(eq(payees.wallet, getAddress(log.args.wallet))).run()
  }
}

export function startIndexer(opts: { db: Db; pub: PublicClient; registry: Address; fromBlock: bigint; intervalMs?: number; onError?: (e: unknown) => void }) {
  const { db, pub, registry } = opts
  let stopped = false
  const tick = async () => {
    try {
      const state = db.select().from(indexerState).where(eq(indexerState.id, 'registry')).get()
      const from = state ? BigInt(state.lastBlock) + 1n : opts.fromBlock
      const head = await pub.getBlockNumber()
      if (from <= head) {
        for (let start = from; start <= head; start += 5000n) {
          const end = start + 4999n > head ? head : start + 4999n
          const logs = await pub.getContractEvents({ address: registry, abi: boundRegistryAbi, fromBlock: start, toBlock: end })
          for (const l of logs) applyRegistryLog(db, l as any)
          db.insert(indexerState).values({ id: 'registry', lastBlock: Number(end) }).onConflictDoUpdate({ target: indexerState.id, set: { lastBlock: Number(end) } }).run()
        }
      }
    } catch (e) { opts.onError?.(e) }
    if (!stopped) setTimeout(tick, opts.intervalMs ?? 4000)
  }
  void tick()
  return () => { stopped = true }
}
