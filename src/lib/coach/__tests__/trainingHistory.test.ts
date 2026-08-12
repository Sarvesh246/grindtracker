import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  COACH_SIGNIFICANT_BREAK_DAYS,
  calendarDaysBetween,
  normalizeWorkoutDates,
  summarizeTrainingHistory,
} from '../trainingHistory'

describe('calendarDaysBetween', () => {
  it('counts whole calendar days between local date keys', () => {
    assert.equal(calendarDaysBetween('2026-01-01', '2026-01-01'), 0)
    assert.equal(calendarDaysBetween('2026-01-01', '2026-01-15'), 14)
    assert.equal(calendarDaysBetween('2026-01-15', '2026-01-01'), -14)
  })
})

describe('normalizeWorkoutDates', () => {
  it('dedupes, sorts, and drops invalid keys', () => {
    assert.deepEqual(
      normalizeWorkoutDates([
        '2026-03-02',
        null,
        '2026-01-01',
        '2026-03-02',
        'nope',
        undefined,
        '2026-02-01',
      ]),
      ['2026-01-01', '2026-02-01', '2026-03-02'],
    )
  })
})

describe('summarizeTrainingHistory', () => {
  it('returns empty summary when there are no workouts', () => {
    const summary = summarizeTrainingHistory([], '2026-08-12')
    assert.equal(summary.first_workout_date, null)
    assert.equal(summary.total_workout_days, 0)
    assert.equal(summary.workouts_last_30_days, 0)
    assert.deepEqual(summary.significant_breaks, [])
  })

  it('computes tenure, consistency windows, and significant layoffs', () => {
    // Trained Jan→mid-Feb, then ~6 week layoff, then resumed late March,
    // then another long gap into August as_of.
    const dates = [
      '2026-01-05',
      '2026-01-07',
      '2026-01-09',
      '2026-02-10',
      '2026-03-28', // idle after Feb 10 = 45 days
      '2026-03-30',
      '2026-04-01',
    ]
    const asOf = '2026-08-12'
    const summary = summarizeTrainingHistory(dates, asOf)

    assert.equal(summary.first_workout_date, '2026-01-05')
    assert.equal(summary.last_workout_date, '2026-04-01')
    assert.equal(summary.days_since_first_workout, calendarDaysBetween('2026-01-05', asOf))
    assert.equal(summary.days_since_last_workout, calendarDaysBetween('2026-04-01', asOf))
    assert.equal(summary.total_workout_days, 7)
    assert.equal(summary.workouts_last_30_days, 0)
    assert.equal(summary.workouts_last_90_days, 0)

    const closed = summary.significant_breaks.find(b => b.before === '2026-03-28')
    assert.ok(closed)
    assert.equal(closed!.after, '2026-02-10')
    assert.equal(closed!.idle_days, 45)

    const open = summary.significant_breaks.find(b => b.before === null)
    assert.ok(open)
    assert.equal(open!.after, '2026-04-01')
    assert.equal(open!.idle_days, calendarDaysBetween('2026-04-01', asOf))
    assert.ok(open!.idle_days >= COACH_SIGNIFICANT_BREAK_DAYS)

    assert.equal(
      summary.longest_break_days,
      Math.max(45, calendarDaysBetween('2026-04-01', asOf)),
    )
  })

  it('ignores short rests under the significant-break threshold', () => {
    const summary = summarizeTrainingHistory(
      ['2026-08-01', '2026-08-03', '2026-08-05', '2026-08-10'],
      '2026-08-12',
    )
    assert.deepEqual(summary.significant_breaks, [])
    assert.equal(summary.longest_break_days, 4) // Aug 5 → Aug 10 idle = 4
    assert.equal(summary.workouts_last_30_days, 4)
    assert.equal(summary.days_since_last_workout, 2)
  })

  it('counts workouts inside rolling windows inclusively', () => {
    const summary = summarizeTrainingHistory(
      ['2026-07-14', '2026-07-20', '2026-08-01', '2026-08-12'],
      '2026-08-12',
    )
    // 30-day inclusive window starts 2026-07-14
    assert.equal(summary.workouts_last_30_days, 4)
    assert.equal(summary.workouts_last_90_days, 4)
  })
})
