import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseWeightOverrides } from '../weightOverrides'

describe('parseWeightOverrides', () => {
  it('keeps sane weights', () => {
    assert.deepEqual(parseWeightOverrides({ a: 165, b: '92.5', c: 0 }), { a: 165, b: 92.5, c: 0 })
  })
  it('drops anything else', () => {
    assert.deepEqual(parseWeightOverrides({ a: -5, b: 5000, c: 'heavy', d: null, e: [1] }), {})
    assert.deepEqual(parseWeightOverrides(null), {})
    assert.deepEqual(parseWeightOverrides([165]), {})
    assert.deepEqual(parseWeightOverrides('{"a":165}'), {})
  })
})
