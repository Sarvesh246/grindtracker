import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  rollupSessionExercises,
  summarizeBodyWeight,
  summarizeRpe,
} from '../contextSummaries'

describe('summarizeBodyWeight', () => {
  it('computes latest, deltas, and 90d range', () => {
    const { summary, recent } = summarizeBodyWeight(
      [
        { date: '2026-08-12', weight_lbs: 180 },
        { date: '2026-08-05', weight_lbs: 182 },
        { date: '2026-07-13', weight_lbs: 185 },
        { date: '2026-05-01', weight_lbs: 190 },
      ],
      '2026-08-12',
      3,
    )
    assert.equal(summary.latest_lbs, 180)
    assert.equal(summary.latest_date, '2026-08-12')
    assert.equal(summary.delta_7d_lbs, -2)
    assert.equal(summary.delta_30d_lbs, -5)
    assert.equal(summary.min_90d_lbs, 180)
    assert.equal(summary.max_90d_lbs, 185)
    assert.equal(summary.n_logs_90d, 3)
    assert.equal(recent.length, 3)
  })
})

describe('summarizeRpe', () => {
  it('averages RPE and flags high-effort exercises', () => {
    const r = summarizeRpe([
      { exercise: 'Squat', set_number: 1, weight_lbs: 225, reps: 5, is_pr: false, is_warmup: false, rpe: 9 },
      { exercise: 'Squat', set_number: 2, weight_lbs: 225, reps: 5, is_pr: false, is_warmup: false, rpe: 9 },
      { exercise: 'Curl', set_number: 1, weight_lbs: 30, reps: 12, is_pr: false, is_warmup: false, rpe: 6 },
      { exercise: 'Squat', set_number: 0, weight_lbs: 135, reps: 5, is_pr: false, is_warmup: true, rpe: 5 },
    ])
    assert.equal(r.sets_with_rpe, 3)
    assert.equal(r.recent_avg, 8)
    assert.deepEqual(r.high_effort_exercises, ['Squat'])
  })
})

describe('rollupSessionExercises', () => {
  it('aggregates working sets per exercise', () => {
    const rows = rollupSessionExercises([
      { exercise: 'Bench', set_number: 1, weight_lbs: 135, reps: 8, is_pr: false, is_warmup: true, rpe: 5 },
      { exercise: 'Bench', set_number: 1, weight_lbs: 185, reps: 5, is_pr: true, is_warmup: false, rpe: 8, note: 'paused' },
      { exercise: 'Bench', set_number: 2, weight_lbs: 185, reps: 4, is_pr: false, is_warmup: false, rpe: 9 },
      { exercise: 'Row', set_number: 1, weight_lbs: 155, reps: 8, is_pr: false, is_warmup: false, rpe: 7 },
    ])
    assert.equal(rows.length, 2)
    assert.equal(rows[0]!.exercise, 'Bench')
    assert.equal(rows[0]!.working_sets, 2)
    assert.equal(rows[0]!.top_weight_lbs, 185)
    assert.equal(rows[0]!.had_pr, true)
    assert.equal(rows[0]!.volume_lbs, 185 * 5 + 185 * 4)
    assert.equal(rows[0]!.avg_rpe, 8.5)
    assert.deepEqual(rows[0]!.notes, ['paused'])
    assert.equal(rows[1]!.exercise, 'Row')
    assert.equal(rows[1]!.working_sets, 1)
  })
})
