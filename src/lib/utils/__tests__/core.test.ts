import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getLevel, getXpInCurrentLevel, getXpRequiredForLevel } from '../gamification'
import { calendarDaysSince, nextDay, advanceIndex, autoSequence, orderedDayKeys } from '../rotation'
import { localDateKey, parseClientLocalDate } from '../formatting'
import {
  datesConnected,
  uncoveredDatesBetween,
  isRestDay,
  skipTodayState,
  weekStartMonday,
} from '../restDays'

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

describe('parseClientLocalDate', () => {
  it('accepts a valid calendar key near UTC today', () => {
    const now = new Date(Date.UTC(2026, 7, 12, 2, 0, 0)) // Aug 12 UTC
    assert.equal(parseClientLocalDate('2026-08-11', { now, daySkew: 2 }), '2026-08-11')
  })

  it('rejects garbage and impossible dates', () => {
    assert.equal(parseClientLocalDate('not-a-date'), null)
    assert.equal(parseClientLocalDate('2026-13-01'), null)
    assert.equal(parseClientLocalDate('2026-02-30'), null)
  })

  it('rejects dates far from UTC today', () => {
    const now = new Date(Date.UTC(2026, 7, 11, 12, 0, 0))
    assert.equal(parseClientLocalDate('2026-01-01', { now, daySkew: 2 }), null)
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

  it('orderedDayKeys follows a manual sequence, not alphabetical', () => {
    assert.deepEqual(
      orderedDayKeys(['legs', 'pull', 'push'], ['push', 'pull', 'legs']),
      ['push', 'pull', 'legs'],
    )
  })

  it('orderedDayKeys dedupes a repeating sequence to first occurrence', () => {
    assert.deepEqual(
      orderedDayKeys(['abs', 'legs', 'pull', 'push'], ['push', 'abs', 'pull', 'abs', 'legs']),
      ['push', 'abs', 'pull', 'legs'],
    )
  })

  it('orderedDayKeys appends days missing from the sequence, alphabetically', () => {
    assert.deepEqual(
      orderedDayKeys(['legs', 'pull', 'push', 'cardio', 'abs'], ['push', 'pull', 'legs']),
      ['push', 'pull', 'legs', 'abs', 'cardio'],
    )
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

  it('honors one-off confirmed rest dates', () => {
    assert.equal(
      datesConnected('2026-08-01', '2026-08-03', new Set(), new Set(['2026-08-02'])),
      true,
    )
  })

  it('ignores a weekday until effective_from', () => {
    const opts = { effectiveFrom: new Map([[3, '2026-08-19']]) }
    assert.equal(isRestDay('2026-08-12', new Set([3]), new Set(), opts), false)
    assert.equal(isRestDay('2026-08-19', new Set([3]), new Set(), opts), true)
  })

  it('treats a cancelled scheduled date as not rest', () => {
    assert.equal(
      isRestDay('2026-08-16', new Set([0]), new Set(), { cancels: new Set(['2026-08-16']) }),
      false,
    )
  })
})

describe('skipTodayState', () => {
  // Week of Mon 10 Aug – Sun 16 Aug 2026. Sunday scheduled as the weekly rest.

  it('lets Wednesday skip by stealing this week\'s upcoming Sunday', () => {
    const wed = '2026-08-12'
    assert.equal(weekStartMonday(wed), '2026-08-10')
    const state = skipTodayState(wed, new Set([0]), new Set())
    assert.equal(state.canSkip, true)
    assert.equal(state.todayIsOneOff, false)
  })

  it('lets Saturday skip by stealing this week\'s Sunday', () => {
    const state = skipTodayState('2026-08-15', new Set([0]), new Set())
    assert.equal(state.canSkip, true)
  })

  it('blocks another skip after this week\'s Sunday was stolen', () => {
    const state = skipTodayState('2026-08-12', new Set([0]), new Set(['2026-08-10']), {
      cancels: new Set(['2026-08-16']),
    })
    assert.equal(state.canSkip, false)
  })

  it('exposes undo on an existing one-off', () => {
    const state = skipTodayState('2026-08-12', new Set(), new Set(['2026-08-12']))
    assert.equal(state.todayIsOneOff, true)
    assert.equal(state.todayIsRest, true)
    assert.equal(state.canSkip, false)
  })

  it('cannot skip when no rest weekdays are configured', () => {
    const state = skipTodayState('2026-08-12', new Set(), new Set())
    assert.equal(state.canSkip, false)
    assert.equal(state.budget, 0)
  })
})

describe('gamification display helpers', () => {
  it('xp required grows linearly with level', () => {
    assert.equal(getXpRequiredForLevel(1), 500)
    assert.equal(getXpRequiredForLevel(3), 1500)
  })

  it('xp in current level at mid-level-2', () => {
    // level 2 starts at 500; 500+250 = 750 → 250 into level 2
    assert.equal(getXpInCurrentLevel(750), 250)
  })
})
