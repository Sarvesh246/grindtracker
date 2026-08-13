import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeDayKey, resolveDayIconKind } from '../dayIcons'

describe('normalizeDayKey', () => {
  it('lowercases and collapses separators', () => {
    assert.equal(normalizeDayKey('Upper_A'), 'upper a')
    assert.equal(normalizeDayKey('full-body'), 'full body')
    assert.equal(normalizeDayKey('ABS'), 'abs')
  })
})

describe('resolveDayIconKind', () => {
  it('maps built-in PPL keys exactly', () => {
    assert.equal(resolveDayIconKind('push'), 'push')
    assert.equal(resolveDayIconKind('pull'), 'pull')
    assert.equal(resolveDayIconKind('legs'), 'legs')
  })

  it('gives abs its own icon — not the pull-up or default dumbbell', () => {
    assert.equal(resolveDayIconKind('abs'), 'abs')
    assert.equal(resolveDayIconKind('core'), 'abs')
    assert.equal(resolveDayIconKind('midsection'), 'abs')
  })

  it('matches template / custom day names by keyword', () => {
    assert.equal(resolveDayIconKind('upper_a'), 'upper')
    assert.equal(resolveDayIconKind('lower_b'), 'legs')
    assert.equal(resolveDayIconKind('full_a'), 'full')
    assert.equal(resolveDayIconKind('full-body'), 'full')
    assert.equal(resolveDayIconKind('arms'), 'arms')
    assert.equal(resolveDayIconKind('shoulders'), 'shoulders')
    assert.equal(resolveDayIconKind('cardio'), 'cardio')
    assert.equal(resolveDayIconKind('hiit'), 'cardio')
  })

  it('falls back to leaderboard category when the name is opaque', () => {
    assert.equal(resolveDayIconKind('day1', 'pull'), 'pull')
    assert.equal(resolveDayIconKind('session-b', 'push'), 'push')
    assert.equal(resolveDayIconKind('mystery', 'other'), 'default')
  })

  it('prefers name keywords over a mismatched category', () => {
    // "abs" tagged as pull for leaderboards still gets the abs glyph.
    assert.equal(resolveDayIconKind('abs', 'pull'), 'abs')
  })
})
