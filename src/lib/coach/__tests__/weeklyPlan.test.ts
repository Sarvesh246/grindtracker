import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { validateWeeklyPlanInput } from '../actions/applyWeeklyPlan'
import { inferCoachIntent } from '../intent'
import { enabledDayKeys, isDayDisabled } from '../../utils/dayKeys'

const lowerA = {
  dayKey: 'Lower A',
  weekday: 'Monday',
  category: 'legs',
  exercises: [
    { name: 'Leg Press', sets_target: 2, reps_target: '10-15', rest_seconds: 120 },
    { name: 'Cable Crunch', sets_target: 3, reps_target: '10-15', rest_seconds: 60 },
  ],
}

describe('validateWeeklyPlanInput', () => {
  it('maps weekdays and keeps per-exercise rest', () => {
    const r = validateWeeklyPlanInput({
      days: [lowerA, { ...lowerA, dayKey: 'Upper A', weekday: 'Wednesday' }],
      restWeekdays: ['Tuesday', 'Thursday'],
    })
    assert.ok(r.ok)
    if (!r.ok) return
    assert.equal(r.days[0]!.dayKey, 'lower a')
    assert.equal(r.days[0]!.weekday, 1)
    assert.equal(r.days[0]!.exercises[0]!.rest_seconds, 120)
    assert.deepEqual(r.restWeekdays, [2, 4])
  })

  it('rejects two workouts on one weekday', () => {
    const r = validateWeeklyPlanInput({
      days: [lowerA, { ...lowerA, dayKey: 'Upper A' }],
    })
    assert.equal(r.ok, false)
  })

  it('rejects a rest weekday that has a workout', () => {
    const r = validateWeeklyPlanInput({ days: [lowerA], restWeekdays: ['mon'] })
    assert.equal(r.ok, false)
  })
})

describe('plan_install intent', () => {
  it('gets a token budget big enough for a whole week', () => {
    const msg =
      'replace my current workout days (besides home abs) with the following:\n' +
      'Monday: Lower A\nTuesday: Rest\nWednesday: Upper A\nThursday: Rest\nFriday: Lower B\nSaturday: Upper B\nSunday: Upper C\n' +
      'x'.repeat(400)
    const p = inferCoachIntent(msg)
    assert.equal(p.intent, 'plan_install')
    assert.ok(p.maxOutputTokens >= 6000)
  })
})

describe('disabled days', () => {
  const rows = [
    { day_type: 'push', active: false },
    { day_type: 'push', active: false },
    { day_type: 'pull', active: true },
    { day_type: 'pull', active: false },
  ]
  it('a day is disabled only when every exercise is inactive', () => {
    assert.deepEqual(enabledDayKeys(rows), ['pull'])
    assert.equal(isDayDisabled(rows, 'push'), true)
    assert.equal(isDayDisabled(rows, 'pull'), false)
    assert.equal(isDayDisabled(rows, 'nope'), false)
  })
})
