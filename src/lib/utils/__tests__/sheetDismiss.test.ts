import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sheetShouldDismiss } from '../sheetDismiss'

describe('sheetShouldDismiss', () => {
  it('commits after 88px of downward travel', () => {
    assert.equal(sheetShouldDismiss(88, 0), true)
    assert.equal(sheetShouldDismiss(120, 0.1), true)
  })

  it('ignores an upward or tiny drag', () => {
    assert.equal(sheetShouldDismiss(-40, 2), false)
    assert.equal(sheetShouldDismiss(12, 1), false)
    assert.equal(sheetShouldDismiss(0, 5), false)
  })

  it('commits a short fast downward flick', () => {
    assert.equal(sheetShouldDismiss(30, 0.7), true)
    assert.equal(sheetShouldDismiss(30, 0.2), false)
  })
})
