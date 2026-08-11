import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { warmupRampWeights, roundToStep } from '../warmupSets'
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
