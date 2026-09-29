import { expect, test } from 'vitest'
import { BOUND_VERSION } from '../src/index'
test('core loads', () => { expect(BOUND_VERSION).toBe('0.1.0') })
