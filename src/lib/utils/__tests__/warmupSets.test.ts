import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { warmupRampWeights, roundToStep, planWarmupRamp, workingWeightForRamp } from '../warmupSets'
import { getWorkoutTemplate, WORKOUT_TEMPLATES } from '../workoutTemplates'
import { sessionsLogsToCsv, exportFilename } from '../exportData'

describe('warmupRampWeights', () => {
  it('returns 40/60/80% rounded to 0.5', () => {
    assert.deepEqual(warmupRampWeights(100), [40, 60, 80])
    assert.deepEqual(warmupRampWeights(225), [90, 135, 180])
  })

  it('returns empty for non-positive working weight', () => {
    assert.deepEqual(warmupRampWeights(0), [])
    assert.deepEqual(warmupRampWeights(-10), [])
  })
})

function set(n: number, weight: string, extra: Partial<{ isWarmup: boolean; checked: boolean; skipped: boolean }> = {}) {
  return {
    setNumber: n,
    weight,
    isWarmup: extra.isWarmup ?? false,
    checked: extra.checked ?? false,
    skipped: extra.skipped ?? false,
  }
}

describe('planWarmupRamp', () => {
  it('adds 3 extras so 3 working sets are not overwritten', () => {
    const sets = [set(1, '225'), set(2, '225'), set(3, '225')]
    const plan = planWarmupRamp(sets, 3, 225)
    assert.equal(plan.ok, true)
    if (!plan.ok) return
    assert.equal(plan.working, 225)
    assert.equal(plan.extraToAdd, 3)
    assert.deepEqual(plan.updates, [
      { setNumber: 1, weight: 90 },
      { setNumber: 2, weight: 135 },
      { setNumber: 3, weight: 180 },
    ])
  })

  it('does not add extras when the ramp is already in front of working sets', () => {
    const sets = [
      set(1, '90', { isWarmup: true }),
      set(2, '135', { isWarmup: true }),
      set(3, '180', { isWarmup: true }),
      set(4, '245'),
      set(5, '245'),
      set(6, '245'),
    ]
    const plan = planWarmupRamp(sets, 3, 225)
    assert.equal(plan.ok, true)
    if (!plan.ok) return
    assert.equal(plan.working, 245)
    assert.equal(plan.extraToAdd, 0)
    assert.equal(plan.updates[2]?.weight, 196)
  })

  it('ignores warmup weights when finding the working load', () => {
    const sets = [
      set(1, '90', { isWarmup: true }),
      set(2, '135', { isWarmup: true }),
      set(3, '180', { isWarmup: true }),
      set(4, '225'),
    ]
    assert.equal(workingWeightForRamp(sets, 315), 225)
  })

  it('uses previous best when every set is blank', () => {
    const sets = [set(1, ''), set(2, ''), set(3, '')]
    const plan = planWarmupRamp(sets, 3, 185)
    assert.equal(plan.ok, true)
    if (!plan.ok) return
    assert.equal(plan.working, 185)
    assert.equal(plan.extraToAdd, 3)
  })

  it('does not overwrite a checked first set', () => {
    const sets = [set(1, '225', { checked: true }), set(2, '225'), set(3, '225')]
    const plan = planWarmupRamp(sets, 3, 225)
    assert.equal(plan.ok, false)
    if (plan.ok) return
    assert.equal(plan.reason, 'nothing-to-fill')
  })

  it('fills an empty leading set when later sets are already logged', () => {
    const sets = [set(1, ''), set(2, '225', { checked: true }), set(3, '225', { checked: true })]
    const plan = planWarmupRamp(sets, 3, 225)
    assert.equal(plan.ok, true)
    if (!plan.ok) return
    assert.equal(plan.extraToAdd, 0)
    assert.deepEqual(plan.updates, [{ setNumber: 1, weight: 90 }])
  })

  it('fails when there is no working weight', () => {
    const plan = planWarmupRamp([set(1, ''), set(2, '')], 2, null)
    assert.equal(plan.ok, false)
    if (plan.ok) return
    assert.equal(plan.reason, 'no-weight')
  })
})

describe('roundToStep', () => {
  it('rounds to nearest step', () => {
    assert.equal(roundToStep(101, 2.5), 100)
    assert.equal(roundToStep(103, 2.5), 102.5)
  })
})

describe('workoutTemplates', () => {
  it('includes ppl, upper-lower, and full-body', () => {
    assert.ok(getWorkoutTemplate('ppl'))
    assert.ok(getWorkoutTemplate('upper-lower'))
    assert.ok(getWorkoutTemplate('full-body'))
    assert.equal(WORKOUT_TEMPLATES.length, 3)
  })

  it('ppl sequence is push→pull→legs', () => {
    assert.deepEqual(getWorkoutTemplate('ppl')!.sequence, ['push', 'pull', 'legs'])
  })
})

describe('exportData', () => {
  it('builds csv with header and one row', () => {
    const csv = sessionsLogsToCsv(
      [{
        id: 's1',
        day_type: 'push',
        local_date: '2026-08-10',
        started_at: '2026-08-10T12:00:00Z',
        completed_at: '2026-08-10T13:00:00Z',
        xp_earned: 100,
        note: null,
      }],
      [{
        session_id: 's1',
        exercise_id: 'e1',
        set_number: 1,
        weight: 135,
        reps: 8,
        is_pr: false,
        rpe: 8,
      }],
      { e1: 'Bench' },
    )
    assert.ok(csv.startsWith('local_date,'))
    assert.ok(csv.includes('Bench'))
    assert.ok(csv.includes('135'))
  })

  it('exportFilename uses local date key', () => {
    assert.match(exportFilename('grind-export'), /^grind-export-\d{4}-\d{2}-\d{2}\.json$/)
  })
})
