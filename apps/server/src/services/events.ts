import type { Db } from '../db/client'
import { events } from '../db/schema'
import { newId } from '../crypto'

export const nowSeconds = () => Math.floor(Date.now() / 1000)

const bigintSafe = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)

export function logEvent(db: Db, e: { id?: string; orgId: string | null; kind: string; invoiceId?: string | null; detail?: unknown; txHash?: string | null }) {
  db.insert(events).values({
    id: e.id ?? newId('ev'),
    orgId: e.orgId,
    kind: e.kind,
    invoiceId: e.invoiceId ?? null,
    detailJson: JSON.stringify(e.detail ?? {}, bigintSafe),
    txHash: e.txHash ?? null,
    createdAt: nowSeconds(),
  }).run()
}
