import { describe, expect, test } from 'vitest'
import { compareNames, jaroWinkler, normalizeName } from '../src/names'

describe('normalizeName', () => {
  test.each([
    ['Acme Ltd.', 'acme'],
    ['ACME LIMITED', 'acme'],
    ['Dangote Cement PLC.', 'dangote cement'],
    ['Acme & Co', 'acme'],
    ['  Globex   Corporation  ', 'globex'],
    ['Ｆｕｌｌｗｉｄｔｈ Ltd', 'fullwidth'],
    ['Ltd', 'ltd'],
  ])('%s -> %s', (raw, expected) => {
    expect(normalizeName(raw).normalized).toBe(expected)
  })

  test('flags Cyrillic lookalike letters', () => {
    const r = normalizeName('Асme Ltd') // first two letters Cyrillic А, с
    expect(r.normalized).toBe('acme')
    expect(r.homoglyph).toBe(true)
  })
})

describe('jaroWinkler', () => {
  test('identical strings score 1', () => { expect(jaroWinkler('acme', 'acme')).toBe(1) })
  test('empty string scores 0', () => { expect(jaroWinkler('', 'acme')).toBe(0) })
  test('close strings score high', () => { expect(jaroWinkler('acme', 'acne')).toBeGreaterThan(0.85) })
})

describe('compareNames', () => {
  test.each([
    ['Acme Ltd', 'ACME Limited', 'MATCH'],
    ['Acme Ltd.', 'Acme', 'MATCH'],
    ['Dangote Cement PLC', 'Dangote Cement Plc.', 'MATCH'],
    ['Acme Holdings Ltd', 'Acme Ltd', 'CLOSE_MATCH'],
    ['Acme Ltd', 'Acme Logistics Ltd', 'CLOSE_MATCH'],
    ['Acne Ltd', 'Acme Ltd', 'CLOSE_MATCH'],
    ['Globex Corporation', 'Acme Ltd', 'NO_MATCH'],
    ['', 'Acme Ltd', 'NO_MATCH'],
  ])('%s vs %s -> %s', (a, b, expected) => {
    expect(compareNames(a, b).result).toBe(expected)
  })

  test('homoglyph name is never a MATCH', () => {
    const r = compareNames('Асme Ltd', 'Acme Ltd')
    expect(r.result).toBe('CLOSE_MATCH')
    expect(r.homoglyph).toBe(true)
  })

  test('registered non-Latin names still match themselves', () => {
    expect(compareNames('Сбер', 'Сбер').result).toBe('MATCH')
  })
  test('invisible characters are stripped and flagged as homoglyph', () => {
    for (const ch of ['\u200b', '\u200d', '\u00ad']) {
      const n = normalizeName(`Ac${ch}me Ltd`)
      expect(n.normalized).toBe('acme')
      expect(n.homoglyph).toBe(true)
      expect(compareNames(`Ac${ch}me Ltd`, 'Acme Ltd').result).toBe('CLOSE_MATCH')
    }
  })
})
