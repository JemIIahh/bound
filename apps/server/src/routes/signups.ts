import { Router, type RequestHandler } from 'express'
import { z } from 'zod'
import type { Config } from '../config'
import { HOUR, perIpLimit } from '../rate-limit'
import { addSignup, SIGNUP_ROLES } from '../services/signups'
import type { ServiceDeps } from '../services/payments'

const body = z.object({
  email: z.string().trim().toLowerCase().max(254, 'Email is too long').email('Enter a valid email address'),
  role: z.enum(SIGNUP_ROLES, { errorMap: () => ({ message: 'Pick payer, supplier, builder or other' }) }),
  company: z.string().trim().max(120, 'Company name is too long').optional(),
}).strict()

const limitFor = (config: Pick<Config, 'signupsPerIpHour'>) =>
  perIpLimit(config.signupsPerIpHour, HOUR, 'Too many sign-ups from this network. Try again later.')

/**
 * Early-access sign-ups (the traction counter). A new email and one already on the list get the same
 * answer, so the endpoint never tells anyone whether an address signed up. There is no listing endpoint:
 * `pnpm --filter @bound/server signups:count` prints the totals.
 */
export function signupsRouter(deps: Pick<ServiceDeps, 'db' | 'config'>, limit: RequestHandler = limitFor(deps.config)) {
  const r = Router()
  r.post('/signups', limit, (req, res) => {
    const b = body.parse(req.body)
    addSignup(deps.db, b)
    res.status(201).json({ ok: true })
  })
  return r
}
