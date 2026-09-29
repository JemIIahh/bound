import { timingSafeEqual } from 'node:crypto'
import type { RequestHandler } from 'express'
import { eq } from 'drizzle-orm'
import { HttpError } from './app'
import { sha256 } from './crypto'
import type { Db } from './db/client'
import { orgs } from './db/schema'

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a, 'utf8')
  const y = Buffer.from(b, 'utf8')
  return x.length === y.length && timingSafeEqual(x, y)
}

/** `authorization: Bearer <orgToken>` must hash to the `:orgId` org's tokenHash; otherwise 401. Sets res.locals.org. */
export function requireOrg(deps: { db: Db }): RequestHandler<any> {
  return (req, res, next) => {
    const m = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.authorization ?? '')
    const orgId: unknown = req.params.orgId
    const org = typeof orgId === 'string' && orgId ? deps.db.select().from(orgs).where(eq(orgs.id, orgId)).get() : undefined
    if (!m || !org || !safeEqual(sha256(m[1]!), org.tokenHash)) return next(new HttpError(401, 'Unauthorized'))
    res.locals.org = org
    next()
  }
}
