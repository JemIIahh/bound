import { domainToASCII } from 'node:url'
import { describe, expect, test } from 'vitest'
import { findLookalikeDomain, isLookalikeDomain, normalizeDomain } from '../src/domain'

describe('normalizeDomain', () => {
  test.each([
    ['https://www.Acme.com/pay', 'acme.com'],
    ['ACME.COM.', 'acme.com'],
    ['billing@acme.com', 'acme.com'],
    ['www.www.victim.com', 'victim.com'],
    ['https://WWW.www.www.Acme.com/pay', 'acme.com'],
  ])('%s -> %s', (raw, expected) => { expect(normalizeDomain(raw)).toBe(expected) })

  test.each(['www.www.acme.com', 'https://www.Acme.com/pay', 'ACME.COM.', 'billing@www.www.acme.com', 'www.acme.com.'])(
    'is idempotent for %s',
    (raw) => { const once = normalizeDomain(raw); expect(normalizeDomain(once)).toBe(once) },
  )
})

describe('isLookalikeDomain', () => {
  test.each([
    ['acme-ltd.co', 'acme.com', true],
    ['acrne.com', 'acme.com', true],
    ['acme.co', 'acme.com', true],
    ['acmee.com', 'acme.com', true],
    [domainToASCII('аcme.com'), 'acme.com', true],
    ['acme.com', 'acme.com', false],
    ['mail.acme.com', 'acme.com', false],
    ['globex.com', 'acme.com', false],
    ['dangote.com.ng', 'dangote.com', true],
  ])('%s vs %s -> %s', (c, r, expected) => { expect(isLookalikeDomain(c, r)).toBe(expected) })

  test('findLookalikeDomain returns the imitated registration', () => {
    const regs = [{ domain: 'acme.com', label: 'Acme Ltd' }, { domain: 'globex.com', label: 'Globex' }]
    expect(findLookalikeDomain('acme-ltd.co', regs)?.label).toBe('Acme Ltd')
    expect(findLookalikeDomain('acme.com', regs)).toBeNull()
  })
})
