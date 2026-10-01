import type { Request, RequestHandler } from 'express'

export type RateLimitOptions = {
  /** Requests allowed per window (also the burst size). */
  limit: number
  windowMs: number
  /** Bucket key for a request; undefined skips limiting. */
  key: (req: Request) => string | undefined
  now?: () => number
  /** Upper bound on tracked keys (memory guard). */
  maxKeys?: number
  /** The 429 body's `error` (default "Too many requests"). */
  message?: string
}

/**
 * Tiny in-memory token bucket per key (single process; no dependency). Each key holds up to `limit`
 * tokens, refilled continuously at `limit` per `windowMs`; a request with no token left gets 429.
 */
export function rateLimit(o: RateLimitOptions): RequestHandler {
  const buckets = new Map<string, { tokens: number; at: number }>()
  const perMs = o.limit / o.windowMs
  const maxKeys = o.maxKeys ?? 10_000
  const now = o.now ?? Date.now

  const prune = (t: number) => {
    for (const [k, b] of buckets) if (b.tokens + (t - b.at) * perMs >= o.limit) buckets.delete(k) // full again: forget it
    while (buckets.size >= maxKeys) buckets.delete(buckets.keys().next().value as string) // still too many: drop oldest
  }

  return (req, res, next) => {
    const key = o.key(req)
    if (key === undefined) return next()
    const t = now()
    let b = buckets.get(key)
    if (!b) {
      if (buckets.size >= maxKeys) prune(t)
      b = { tokens: o.limit, at: t }
      buckets.set(key, b)
    } else {
      b.tokens = Math.min(o.limit, b.tokens + (t - b.at) * perMs)
      b.at = t
    }
    if (b.tokens < 1) {
      res.set('retry-after', String(Math.max(1, Math.ceil((1 - b.tokens) / perMs / 1000))))
      res.status(429).json({ error: o.message ?? 'Too many requests' })
      return
    }
    b.tokens -= 1
    next()
  }
}

const MINUTE = 60_000
export const HOUR = 60 * MINUTE

/** The client IP. Behind a reverse proxy, set Express `trust proxy` so req.ip is the client, not the proxy. */
export const clientIp = (req: Request) => req.ip ?? req.socket.remoteAddress ?? 'unknown'

/** Per client IP (public routes: /mcp, POST /v1/verify). */
export const perIpLimit = (limit = 60, windowMs = MINUTE, message?: string) => rateLimit({ limit, windowMs, key: clientIp, message })

/** Per org (costly routes: invoice submission, lab runs). Mount after requireOrg so only the org's own token spends it. */
export const perOrgLimit = (limit = 10) => rateLimit({ limit, windowMs: MINUTE, key: (req) => (typeof req.params.orgId === 'string' ? req.params.orgId : undefined) })
