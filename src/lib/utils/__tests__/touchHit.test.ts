import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  pickSmallestContainingHost,
  pointInRect,
  touchHitCandidates,
  type HitHost,
} from '../touchHit'

describe('pointInRect', () => {
  const box = { left: 100, top: 400, right: 144, bottom: 444, width: 44, height: 44 }

  it('contains the center', () => {
    assert.equal(pointInRect({ x: 122, y: 422 }, box, 0), true)
  })

  it('rejects a point a status-bar below the control', () => {
    assert.equal(pointInRect({ x: 122, y: 422 + 59 }, box, 0), false)
  })

  it('allows a couple px of slop', () => {
    assert.equal(pointInRect({ x: 122, y: 445 }, box, 2), true)
    assert.equal(pointInRect({ x: 122, y: 447 }, box, 2), false)
  })
})

describe('touchHitCandidates', () => {
  it('always includes the raw finger point', () => {
    assert.deepEqual(touchHitCandidates(10, 20), [{ x: 10, y: 20 }])
  })

  it('adds ± visualViewport pan so layout vs visual coords both get a try', () => {
    assert.deepEqual(touchHitCandidates(10, 400, 0, 59), [
      { x: 10, y: 400 },
      { x: 10, y: 459 },
      { x: 10, y: 341 },
    ])
  })
})

describe('pickSmallestContainingHost', () => {
  const save: HitHost<string> = {
    el: 'save',
    rect: { left: 300, top: 400, right: 344, bottom: 444, width: 44, height: 44 },
  }
  const addSet: HitHost<string> = {
    el: 'add-set',
    rect: { left: 16, top: 452, right: 360, bottom: 492, width: 344, height: 40 },
  }

  it('picks Save when the finger is on Save even if Add Set is the native target', () => {
    assert.equal(
      pickSmallestContainingHost([save, addSet], [{ x: 322, y: 422 }]),
      'save',
    )
  })

  it('still picks Add Set when the finger is actually on Add Set', () => {
    assert.equal(
      pickSmallestContainingHost([save, addSet], [{ x: 180, y: 470 }]),
      'add-set',
    )
  })

  it('recovers a leftover 59px visualViewport pan (finger visual, rects layout)', () => {
    const points = touchHitCandidates(322, 422, 0, 59)
    const layoutSave: HitHost<string> = {
      el: 'save',
      rect: { left: 300, top: 459, right: 344, bottom: 503, width: 44, height: 44 },
    }
    const layoutAdd: HitHost<string> = {
      el: 'add-set',
      rect: { left: 16, top: 511, right: 360, bottom: 551, width: 344, height: 40 },
    }
    assert.equal(pickSmallestContainingHost([layoutSave, layoutAdd], points), 'save')
  })

  it('prefers the smaller control when rects overlap', () => {
    const parent: HitHost<string> = {
      el: 'row',
      rect: { left: 0, top: 390, right: 400, bottom: 450, width: 400, height: 60 },
    }
    assert.equal(
      pickSmallestContainingHost([parent, save], [{ x: 322, y: 422 }]),
      'save',
    )
  })

  it('returns null when nothing contains the point', () => {
    assert.equal(pickSmallestContainingHost([save, addSet], [{ x: 10, y: 10 }]), null)
  })
})
