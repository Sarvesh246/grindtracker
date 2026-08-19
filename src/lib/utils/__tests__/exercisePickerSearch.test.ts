import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolveSearchSubmit } from '../exercisePickerSearch'

const catalog = [
  { id: '1', name: 'Bench Press' },
  { id: '2', name: 'Bent Over Row' },
]

describe('resolveSearchSubmit', () => {
  it('picks an exact catalog match', () => {
    assert.deepEqual(
      resolveSearchSubmit('bench press', catalog, true),
      { type: 'pick', id: '1' },
    )
  })

  it('does not auto-pick a single fuzzy match', () => {
    assert.deepEqual(
      resolveSearchSubmit('ben', catalog, true),
      { type: 'create' },
    )
  })

  it('opens create for a new name', () => {
    assert.deepEqual(
      resolveSearchSubmit('Lateral Raise', catalog, true),
      { type: 'create' },
    )
  })

  it('does nothing when create is not allowed and there is no exact hit', () => {
    assert.deepEqual(
      resolveSearchSubmit('ben', catalog, false),
      { type: 'none' },
    )
  })

  it('ignores an empty query', () => {
    assert.deepEqual(resolveSearchSubmit('   ', catalog, true), { type: 'none' })
  })
})
