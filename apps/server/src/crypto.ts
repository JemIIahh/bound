import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto'

const keyFrom = (secret: `0x${string}`) => Buffer.from(secret.slice(2), 'hex')

export function encryptSecret(plain: string, secret: `0x${string}`): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', keyFrom(secret), iv)
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return [iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join('.')
}

export function decryptSecret(blob: string, secret: `0x${string}`): string {
  const [iv, tag, ct] = blob.split('.')
  const d = createDecipheriv('aes-256-gcm', keyFrom(secret), Buffer.from(iv!, 'base64'))
  d.setAuthTag(Buffer.from(tag!, 'base64'))
  return Buffer.concat([d.update(Buffer.from(ct!, 'base64')), d.final()]).toString('utf8')
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
export const newId = (prefix: string, bytes = 9) => `${prefix}_${randomBytes(bytes).toString('base64url')}`
export const newToken = () => randomBytes(24).toString('base64url')
