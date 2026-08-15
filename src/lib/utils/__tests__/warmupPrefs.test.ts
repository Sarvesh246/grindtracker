import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  clampWarmupPercent,
  formatWarmupPercentsList,
  normalizeWarmupPercents,
  parseWarmupPrefRaw,
  percentsToFractions,
} from '../warmupPrefs'
import { planWarmupRamp } from '../warmupSets'

describe('normalizeWarmupPercents', () => {
  it('defaults when the value is missing or junk', () => {
    assert.deepEqual(normalizeWarmupPercents(null), [40, 60, 80])
    assert.deepEqual(normalizeWarmupPercents('nope'), [40, 60, 80])
  })

  it('clamps, drops junk, and caps at 5', () => {
    assert.deepEqual(normalizeWarmupPercents([1, 50, 150, 'x', 70, 80, 90, 95]), [5, 50, 70, 80, 90])
  })

  it('allows an empty ramp (feature off)', () => {
    assert.deepEqual(normalizeWarmupPercents([]), [])
  })
})

describe('parseWarmupPrefRaw', () => {
  it('reads JSON and comma lists', () => {
    assert.deepEqual(parseWarmupPrefRaw('[50,75]'), [50, 75])
    assert.deepEqual(parseWarmupPrefRaw('30, 50, 70'), [30, 50, 70])
  })
})

describe('clampWarmupPercent / format', () => {
  it('clamps to 5–95', () => {
    assert.equal(clampWarmupPercent(0), 5)
    assert.equal(clampWarmupPercent(200), 95)
  })

  it('formats lists for copy', () => {
    assert.equal(formatWarmupPercentsList([40, 60, 80]), '40%, 60%, then 80%')
    assert.equal(formatWarmupPercentsList([50]), '50%')
    assert.equal(formatWarmupPercentsList([]), 'none')
  })
})

describe('planWarmupRamp custom fractions', () => {
  it('uses the configured count and percents', () => {
    const sets = [
      { setNumber: 1, weight: '200', isWarmup: false, checked: false, skipped: false },
      { setNumber: 2, weight: '200', isWarmup: false, checked: false, skipped: false },
    ]
    const plan = planWarmupRamp(sets, 2, 200, percentsToFractions([50, 75]))
    assert.equal(plan.ok, true)
    if (!plan.ok) return
    assert.equal(plan.extraToAdd, 2)
    assert.deepEqual(plan.updates, [
      { setNumber: 1, weight: 100 },
      { setNumber: 2, weight: 150 },
    ])
  })
})
