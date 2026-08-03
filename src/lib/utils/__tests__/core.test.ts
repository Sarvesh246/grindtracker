import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getLevel, getXpInCurrentLevel, getXpRequiredForLevel } from '../gamification'
import { calendarDaysSince, nextDay, advanceIndex, autoSequence } from '../rotation'
import { localDateKey } from '../formatting'
import { datesConnected, uncoveredDatesBetween } from '../restDays'

describe('gamification level curve', () => {
  it('level 1 at 0 XP', () => {
    assert.equal(getLevel(0), 1)
  })

  it('level advances on triangular curve', () => {
    // cumulative XP for level n is 500 * n * (n-1) / 2
    // so level 2 starts at 500, level 3 at 1500
    assert.equal(getLevel(499), 1)
    assert.equal(getLevel(500), 2)
    assert.equal(getLevel(1499), 2)
    assert.equal(getLevel(1500), 3)
  })

  it('xp in current level resets after each level-up', () => {
    assert.equal(getXpInCurrentLevel(500), 0)
    assert.equal(getXpRequiredForLevel(2), 1000)
  })
})

describe('localDateKey', () => {
  it('formats YYYY-MM-DD from local components', () => {
    const d = new Date(2026, 7, 3, 23, 30, 0) // Aug 3 local
    assert.equal(localDateKey(d), '2026-08-03')
  })
})

describe('rotation', () => {
  it('autoSequence is alphabetical unique', () => {
    assert.deepEqual(autoSequence(['legs', 'push', 'pull']), ['legs', 'pull', 'push'])
  })

  it('nextDay wraps', () => {
    const seq = ['push', 'pull', 'legs']
    assert.equal(nextDay(seq, -1), 'push')
    assert.equal(nextDay(seq, 0), 'pull')
    assert.equal(nextDay(seq, 2), 'push')
  })

  it('advanceIndex points at completed day', () => {
    const seq = ['push', 'pull', 'legs']
    assert.equal(advanceIndex(seq, -1, 'push'), 0)
    assert.equal(advanceIndex(seq, 0, 'legs'), 2)
  })
})

describe('calendarDaysSince', () => {
  it('accepts local_date keys without UTC shift', () => {
    const now = new Date(2026, 7, 3, 12, 0, 0)
    assert.equal(calendarDaysSince('2026-08-01', now), 2)
  })
})

describe('rest days connectivity', () => {
  it('treats adjacent days as connected', () => {
    assert.equal(datesConnected('2026-08-01', '2026-08-02', new Set(), new Set()), true)
  })

  it('requires every middle day to be rest', () => {
    // Aug 1 (Sat) to Aug 3 (Mon) — Sunday (0) is between
    assert.equal(datesConnected('2026-08-01', '2026-08-03', new Set([0]), new Set()), true)
    assert.equal(datesConnected('2026-08-01', '2026-08-03', new Set(), new Set()), false)
  })

  it('lists uncovered days in a gap', () => {
    const gap = uncoveredDatesBetween('2026-08-01', '2026-08-04', new Set(), new Set())
    assert.deepEqual(gap, ['2026-08-02', '2026-08-03'])
  })
})
