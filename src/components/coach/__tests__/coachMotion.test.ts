import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  FLICK_AXIS_DOMINANCE,
  FLICK_VELOCITY_PX_S,
  RUBBER_FACTOR,
  SHEET_DISMISS_FLICK_VY,
  SHEET_DISMISS_FRAC,
  SHEET_DISMISS_MIN_PX,
  SHEET_EXPAND_FRAC,
  SHEET_FLICK_VY,
  SHEET_MINIMIZE_FRAC,
  SHEET_MINIMIZE_MIN_PX,
  clamp,
  dockFromFlick,
  sheetDismissThreshold,
  sheetExpandThreshold,
  sheetMinimizeThreshold,
} from '../coachMotion'

const VW = 390
const VH = 844

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

describe('coachMotion sheet snap thresholds', () => {
  it('keeps a wide minimize zone below dismiss', () => {
    assert.ok(SHEET_MINIMIZE_FRAC < SHEET_DISMISS_FRAC)
    assert.ok(SHEET_MINIMIZE_MIN_PX < SHEET_DISMISS_MIN_PX)
    assert.ok(SHEET_FLICK_VY < SHEET_DISMISS_FLICK_VY)
    assert.equal(SHEET_MINIMIZE_FRAC, 0.12)
    assert.equal(SHEET_DISMISS_FRAC, 0.72)
    assert.equal(SHEET_EXPAND_FRAC, 0.18)
    assert.equal(SHEET_FLICK_VY, 680)
    assert.equal(SHEET_DISMISS_FLICK_VY, 2400)
    // Soft flick must stay clearly below hard-dismiss so a normal pull
    // settles to compact instead of closing.
    assert.ok(SHEET_DISMISS_FLICK_VY - SHEET_FLICK_VY >= 1500)
    // Dismiss distance must leave a deep compact-only band.
    assert.ok(SHEET_DISMISS_FRAC - SHEET_MINIMIZE_FRAC >= 0.55)
  })

  it('computes distance gates from height', () => {
    assert.equal(sheetMinimizeThreshold(400), Math.max(48, 400 * 0.12))
    assert.equal(sheetDismissThreshold(400), Math.max(340, 400 * 0.72))
    assert.equal(sheetMinimizeThreshold(800), Math.max(48, 800 * 0.12))
    assert.equal(sheetDismissThreshold(800), Math.max(340, 800 * 0.72))
    // Expand caps at 120px so tall sheets aren't a long pull.
    assert.equal(sheetExpandThreshold(800), 120)
    assert.equal(sheetExpandThreshold(200), Math.max(64, 200 * 0.18))
  })

  it('always places dismiss well above minimize for typical heights', () => {
    for (const h of [320, 420, 640, 844, 1000]) {
      assert.ok(
        sheetDismissThreshold(h) > sheetMinimizeThreshold(h) + 200,
        `height ${h}: dismiss should sit well above minimize`,
      )
    }
  })
})
