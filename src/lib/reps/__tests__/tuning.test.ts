import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { analyze, cleanParams, TUNE_DEFAULTS } from '../../../../watch/tools/reps.mjs'
import { eligible, falsePositives, MIN_SETS, NO_SET_SLACK, tuneExercise } from '../../../../watch/tools/tune.mjs'
import { pending, RETUNE_AFTER_NEW_SETS } from '../tuning'

let seed = 11
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5

/** A stored rep_lab_sets row: still, `reps` reps of `period` s, still. */
function row(reps: number, period: number, extra: Record<string, unknown> = {}) {
  const x: number[] = [], y: number[] = [], z: number[] = []
  const still = (n: number) => { for (let i = 0; i < n; i++) { x.push(20 * rnd()); y.push(-1000 + 20 * rnd()); z.push(20 * rnd()) } }
  still(38)
  const n = Math.round(reps * period * 12.5)
  for (let i = 0; i < n; i++) {
    const ph = (2 * Math.PI * i) / (period * 12.5)
    const a = 350 * ((1 - Math.cos(ph)) / 2) * (1 + 0.1 * rnd())
    x.push(150 * Math.sin(ph) + 30 * rnd()); y.push(-1000 + a + 30 * rnd()); z.push(0.1 * a + 30 * rnd())
  }
  still(25)
  return { motion_x: x.map(Math.round), motion_y: y.map(Math.round), motion_z: z.map(Math.round), steps: [], logged_reps: reps, diag: null, ...extra }
}

describe('rep counter tuning', () => {
  it('cleanParams keeps only valid, in-range settings, rounded like the watch', () => {
    assert.deepEqual(cleanParams({ ac: 0.551, cv: 9, swing: 'x', lag: 6.6, evil: 1 }), { ac: 0.55, lag: 7 })
    assert.deepEqual(cleanParams(null), {})
  })

  it('analyze with no params is the default counter, and params never leak', () => {
    const r = row(8, 2)
    const g = (a: number[]) => a.map(v => v / 1000)
    const base = analyze(g(r.motion_x), g(r.motion_y), g(r.motion_z), new Array(r.motion_x.length).fill(0))
    analyze(g(r.motion_x), g(r.motion_y), g(r.motion_z), new Array(r.motion_x.length).fill(0), { ac: 0.75, lag: 10 })
    const again = analyze(g(r.motion_x), g(r.motion_y), g(r.motion_z), new Array(r.motion_x.length).fill(0))
    assert.deepEqual([again.reps, again.ok], [base.reps, base.ok])
  })

  it('learns faster reps when the defaults miss them, proven on held-out sets', () => {
    const fast = Array.from({ length: 30 }, (_, i) => row(8 + (i % 5), 1.05 + 0.05 * (i % 3)))
    const t = tuneExercise(fast)!
    assert.equal(t.applied, true)
    assert.ok(((t.params as { lag?: number }).lag ?? 8) < TUNE_DEFAULTS.lag)
    assert.ok(t.tunedExact >= t.defaultExact + 2)
    assert.ok(t.tunedWrong <= t.defaultWrong)
    assert.ok(t.noSetCounts.tuned <= t.noSetCounts.defaults + NO_SET_SLACK)
  })

  it('changes nothing when the defaults already count right', () => {
    const normal = Array.from({ length: 30 }, (_, i) => row(8 + (i % 5), 2 + 0.3 * (i % 3)))
    const t = tuneExercise(normal)!
    assert.equal(t.applied, false)
    assert.deepEqual(t.params, {})
  })

  it('waits for enough usable sets; sensor-gap sets do not count', () => {
    const sets = Array.from({ length: MIN_SETS - 1 }, () => row(8, 2))
    assert.equal(tuneExercise(sets), null)
    assert.equal(tuneExercise([...sets, row(8, 2, { diag: { interrupted: true } })]), null)
  })

  it('excludes accepted AUTO values from training until independently corrected', () => {
    const accepted = row(5, 2, { auto_shown: true })
    assert.equal(eligible(accepted), false)
    assert.equal(eligible({ ...accepted, corrected: true, logged_reps: 15 }), true)
    assert.equal(eligible({ ...accepted, corrected: true, clipped: true }), false)
  })

  it('the walking guard has a real baseline to protect', () => {
    const d = falsePositives(TUNE_DEFAULTS)
    assert.ok(d >= 0 && d < 20, `defaults show a count on ${d} of 200 no-lift sessions`)
  })

  it('re-tunes new exercises, a changed counter, or after 5 new sets', () => {
    const counts = [
      { user_id: 'u', exercise_id: 'a', n: 25 },
      { user_id: 'u', exercise_id: 'b', n: 30 },
      { user_id: 'u', exercise_id: 'c', n: 40 },
      { user_id: 'u', exercise_id: 'd', n: 10 },
    ]
    const existing = [
      { user_id: 'u', exercise_id: 'b', algo_version: 'old', sets_used: 30 },
      { user_id: 'u', exercise_id: 'c', algo_version: '2026-11-18', sets_used: 40 - RETUNE_AFTER_NEW_SETS + 1 },
    ]
    assert.deepEqual(pending(counts, existing, '2026-11-18').map(c => c.exercise_id), ['b', 'a'])
  })
})
