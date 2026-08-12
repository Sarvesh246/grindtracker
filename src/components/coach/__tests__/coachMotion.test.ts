import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  FLICK_AXIS_DOMINANCE,
  FLICK_VELOCITY_PX_S,
  RUBBER_FACTOR,
  clamp,
  dockFromFlick,
  squashFromVelocity,
} from '../coachMotion'

const VW = 390
const VH = 844

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

describe('coachMotion dockFromFlick', () => {
  it('TR + leftward velocity docks to tl (preserves top half)', () => {
    // Top-right release, mostly-horizontal flick left (small accidental down).
    const next = dockFromFlick(340, 80, -900, 80, VW, VH)
    assert.equal(next, 'tl')
  })

  it('TL + rightward velocity docks to tr', () => {
    const next = dockFromFlick(50, 80, 900, -40, VW, VH)
    assert.equal(next, 'tr')
  })

  it('BR + upward velocity docks to tr (preserves right half)', () => {
    const next = dockFromFlick(340, 700, 60, -900, VW, VH)
    assert.equal(next, 'tr')
  })

  it('BL + downward velocity docks to bl when already bottom-left', () => {
    const next = dockFromFlick(50, 700, 40, 900, VW, VH)
    assert.equal(next, 'bl')
  })

  it('clear diagonal uses both axes (TR → bl)', () => {
    const next = dockFromFlick(340, 80, -800, 800, VW, VH)
    assert.equal(next, 'bl')
  })

  it('clear diagonal uses both axes (BL → tr)', () => {
    const next = dockFromFlick(50, 700, 800, -800, VW, VH)
    assert.equal(next, 'tr')
  })
})

describe('coachMotion constants', () => {
  it('exposes softer flick threshold and ~0.2 rubber', () => {
    assert.equal(FLICK_VELOCITY_PX_S, 580)
    assert.equal(FLICK_AXIS_DOMINANCE, 1.55)
    assert.equal(RUBBER_FACTOR, 0.2)
  })

  it('clamps numbers', () => {
    assert.equal(clamp(5, 0, 3), 3)
    assert.equal(clamp(-1, 0, 3), 0)
  })
})
