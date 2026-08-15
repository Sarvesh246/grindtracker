import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { swipeFlyOff, swipeShouldDismiss } from '../swipeDismiss'

describe('swipeShouldDismiss', () => {
  it('commits after 40px in any direction', () => {
    assert.equal(swipeShouldDismiss(40, 0, 400), true)
    assert.equal(swipeShouldDismiss(-40, 2, 400), true)
    assert.equal(swipeShouldDismiss(0, 40, 400), true)
    assert.equal(swipeShouldDismiss(3, -40, 400), true)
  })

  it('ignores a small wobble', () => {
    assert.equal(swipeShouldDismiss(12, 8, 400), false)
  })

  it('commits a short fast flick', () => {
    assert.equal(swipeShouldDismiss(20, 0, 30), true)
  })
})

describe('swipeFlyOff', () => {
  it('projects along the drag vector', () => {
    const out = swipeFlyOff(10, 0, 100)
    assert.equal(out.x, 100)
    assert.equal(out.y, 0)
  })
})
