import { count } from 'drizzle-orm'
import type { Db } from '../db/client'
import { signups } from '../db/schema'
import { nowSeconds } from './events'

export const SIGNUP_ROLES = ['payer', 'supplier', 'builder', 'other'] as const
export type SignupRole = (typeof SIGNUP_ROLES)[number]

/** Records an early-access sign-up. Returns false when the (lower-cased) email was already there; the first entry is kept. */
export function addSignup(db: Db, s: { email: string; role: SignupRole; company?: string | null }): boolean {
  const res = db.insert(signups)
    .values({ email: s.email.trim().toLowerCase(), role: s.role, company: s.company?.trim() || null, createdAt: nowSeconds() })
    .onConflictDoNothing().run()
  return res.changes === 1
}

/** Totals for the traction counter: all sign-ups and per role. Never reads an email. */
export function signupCounts(db: Db): { total: number; byRole: Record<SignupRole, number> } {
  const byRole = Object.fromEntries(SIGNUP_ROLES.map((r) => [r, 0])) as Record<SignupRole, number>
  let total = 0
  for (const row of db.select({ role: signups.role, n: count() }).from(signups).groupBy(signups.role).all()) {
    total += row.n
    if (row.role in byRole) byRole[row.role as SignupRole] = row.n
  }
  return { total, byRole }
}
