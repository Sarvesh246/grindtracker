import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  SWIPE_DISMISS_PX,
  SWIPE_FLICK_PX,
  swipeFlyOff,
  swipeShouldDismiss,
} from '../swipeDismiss'

describe('swipeShouldDismiss', () => {
  it('ignores small wobble in any direction', () => {
    assert.equal(swipeShouldDismiss(12, 0, 200), false)
    assert.equal(swipeShouldDismiss(-8, 6, 180), false)
    assert.equal(swipeShouldDismiss(0, -10, 250), false)
  })

  it('dismisses a left, right, or up swipe past the distance threshold', () => {
    assert.equal(swipeShouldDismiss(-SWIPE_DISMISS_PX, 0, 300), true)
    assert.equal(swipeShouldDismiss(SWIPE_DISMISS_PX, 4, 300), true)
    assert.equal(swipeShouldDismiss(0, -SWIPE_DISMISS_PX, 300), true)
  })

  it('also dismisses a downward swipe past the threshold', () => {
    assert.equal(swipeShouldDismiss(0, SWIPE_DISMISS_PX, 300), true)
  })

  it('dismisses a short but fast flick', () => {
    assert.equal(swipeShouldDismiss(0, -SWIPE_FLICK_PX, 30), true)
    assert.equal(swipeShouldDismiss(SWIPE_FLICK_PX, 0, 30), true)
  })

  it('does not treat a slow short drag as a flick', () => {
    assert.equal(swipeShouldDismiss(0, -SWIPE_FLICK_PX, 400), false)
  })
})

describe('swipeFlyOff', () => {
  it('projects the drag vector out to a far off-screen point', () => {
    const left = swipeFlyOff(-40, 0, 200)
    assert.equal(left.x, -200)
    assert.equal(left.y, 0)

    const up = swipeFlyOff(0, -20, 200)
    assert.equal(up.x, 0)
    assert.equal(up.y, -200)
  })

  it('defaults to flying up when the drag is ~zero', () => {
    const fly = swipeFlyOff(0, 0, 200)
    assert.equal(fly.x, 0)
    assert.equal(fly.y, -200)
  })
})
