import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  FLICK_VELOCITY_PX_S,
  RUBBER_FACTOR,
  clamp,
  squashFromVelocity,
} from '../coachMotion'

describe('coachMotion squashFromVelocity', () => {
  it('returns 1:1 when nearly still', () => {
    const s = squashFromVelocity(0, 0)
    assert.equal(s.sx, 1)
    assert.equal(s.sy, 1)
  })

  it('stretches along the dominant axis', () => {
    const h = squashFromVelocity(2000, 0)
    assert.ok(h.sx > 1)
    assert.ok(h.sy < 1)
    const v = squashFromVelocity(0, 2000)
    assert.ok(v.sy > 1)
    assert.ok(v.sx < 1)
  })

  it('clamps within liquid range', () => {
    const s = squashFromVelocity(99999, 0)
    assert.ok(s.sx <= 1.18 + 1e-9)
    assert.ok(s.sy >= 0.82 - 1e-9)
  })
})

describe('coachMotion constants', () => {
  it('exposes ~500 px/s flick threshold and ~0.2 rubber', () => {
    assert.equal(FLICK_VELOCITY_PX_S, 500)
    assert.equal(RUBBER_FACTOR, 0.2)
  })

  it('clamps numbers', () => {
    assert.equal(clamp(5, 0, 3), 3)
    assert.equal(clamp(-1, 0, 3), 0)
  })
})
