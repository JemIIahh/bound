import { expect, test } from 'vitest'
import { createDb, migrate } from '../src/db/client'
import { payees, events, pins, orgs } from '../src/db/schema'
import { applyRegistryLog } from '../src/indexer'
import { eq } from 'drizzle-orm'

const acme = '0xCcB7f43C7D6DBbC4e545d8C01761098da5332ED2'
const acme2 = '0x2222222222222222222222222222222222222222'

test('attest then supersede updates the mirror and alerts pinned orgs', () => {
  const db = createDb(':memory:'); migrate(db)
  db.insert(orgs).values({ id: 'org1', name: 'Buyer', rootAddress: '0x' + '33'.repeat(20), agentKeyAddress: '0x' + '44'.repeat(20), agentKeyEnc: 'x', tokenHash: 'h', limitBase: '1', periodSeconds: 3600, createdAt: 1 }).run()
  db.insert(pins).values({ orgId: 'org1', wallet: acme, label: 'Acme Ltd', approvedAt: 1, active: 1 }).run()
  applyRegistryLog(db, { eventName: 'PayeeAttested', blockNumber: 10n, args: { wallet: acme, domainHash: '0x', legalName: 'Acme Ltd', domain: 'acme.com', lei: '', masterId: '0x83196cf2', level: 1, activeFrom: 100n, evidenceHash: '0x00' } })
  expect(db.select().from(payees).where(eq(payees.wallet, acme)).get()?.legalName).toBe('Acme Ltd')
  applyRegistryLog(db, { eventName: 'PayeeSuperseded', blockNumber: 11n, args: { oldWallet: acme, newWallet: acme2, activeFrom: 500n } })
  expect(db.select().from(payees).where(eq(payees.wallet, acme)).get()?.successor).toBe(acme2)
  const alerts = db.select().from(events).where(eq(events.kind, 'changed_alert')).all()
  expect(alerts.length).toBe(1)
  expect(alerts[0]?.orgId).toBe('org1')
})
