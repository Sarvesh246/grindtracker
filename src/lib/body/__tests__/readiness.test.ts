import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeRr, cleanMask, dailyReadings, hrvScore, summarizeReadiness, type ReadinessCheck } from '../hrv'
import { dailyStrength, e1rm, fallingRecovery, stalled, strengthLoad, strengthScore, type StrengthSet } from '../strength'
import { computeCharge } from '../charge'
import type { DailyBody } from '../types'

const TODAY = '2026-11-18'
function shift(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00`)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The same fixture the watch's testReadinessMathMatchesServer uses. */
const FIXTURE = [930, 976, 998, 992, 1015, 994, 994, 989, 973, 965, 480, 924, 891, 881, 881, 898, 895, 897, 950, 946, 956, 987, 1020, 1015, 999, 1900, 2600, 966, 939, 936, 919, 915, 886, 879, 901, 909, 904, 947, 974, 988, 1450, 1020, 1014, 1020, 992, 984, 958, 949, 927, 902, 914, 888, 878, 889, 917, 250, 936, 959, 980, 986, 1006, 1011, 1011, 1004, 1004, 968, 943, 928, 922, 894]

describe('readiness HRV', () => {
  it('removes missed, doubled and out-of-range beats', () => {
    const mask = cleanMask(FIXTURE)
    for (const i of [10, 25, 26, 40, 55]) assert.equal(mask[i], false, `beat ${i}`)
    assert.equal(mask.filter(Boolean).length, 65)
  })

  it('matches the watch on the shared fixture', () => {
    const r = analyzeRr(FIXTURE, 2)
    assert.deepEqual(
      [r.rmssd, r.meanHr, r.cleanBeats, r.cleanPairs, r.artifactPct, r.quality],
      [20.4, 63.1, 65, 60, 7.1, 'good'],
    )
  })

  it('never diffs across a removed beat', () => {
    // A lone 1800 between steady 1000s would add a 800 ms jump twice.
    const steady = Array.from({ length: 60 }, (_, i) => 1000 + (i % 2 ? 10 : -10))
    const withSpike = [...steady.slice(0, 30), 1800, ...steady.slice(30)]
    assert.equal(analyzeRr(withSpike).rmssd, analyzeRr(steady).rmssd)
  })

  it('grades quality: too short, moving, too noisy, flat', () => {
    assert.equal(analyzeRr(FIXTURE.slice(0, 25)).reason, 'too few beats')
    assert.equal(analyzeRr(FIXTURE, 12).quality, 'poor')
    assert.equal(analyzeRr(FIXTURE, 6).quality, 'fair')
    assert.equal(analyzeRr(new Array(60).fill(1000)).reason, 'flat signal')
    assert.equal(analyzeRr([]).quality, 'poor')
  })

  const check = (date: string, rmssd: number, at = '06:30', quality: 'good' | 'fair' | 'poor' = 'good'): ReadinessCheck => ({
    local_date: date, measured_at: `${date}T${at}:00Z`, rmssd, ln_rmssd: Math.log(rmssd), mean_hr: 55, quality,
  })

  it('takes the first usable check of each day and skips poor ones', () => {
    const d = dailyReadings([check(TODAY, 40, '09:00'), check(TODAY, 60, '06:00', 'poor'), check(TODAY, 50, '07:00')])
    assert.equal(d.get(TODAY)!.rmssd, 50)
  })

  it('needs five mornings for a baseline, then scores today against it', () => {
    const four = [1, 2, 3, 4].map(i => check(shift(TODAY, -i), 50 + i))
    assert.equal(summarizeReadiness([...four, check(TODAY, 30)], TODAY).baseline, null)
    const ten = Array.from({ length: 10 }, (_, i) => check(shift(TODAY, -(i + 1)), 50 + (i % 3) * 4))
    const low = summarizeReadiness([...ten, check(TODAY, 30)], TODAY)
    assert.equal(low.status, 'below')
    assert.ok(low.baseline!.lowMs <= 50 && low.baseline!.highMs >= 54)
    assert.ok(low.z! < -1)
    assert.equal(summarizeReadiness([...ten, check(TODAY, 53)], TODAY).status, 'within')
  })

  it('hrvScore: full marks at usual, about 30 off per SD below', () => {
    assert.equal(hrvScore(0.5), 100)
    assert.equal(hrvScore(0), 90)
    assert.equal(hrvScore(-1), 60)
    assert.equal(hrvScore(-4), 0)
  })
})

describe('lifting load', () => {
  const set = (date: string, ex: string, weight: number | null, reps: number): StrengthSet => ({ local_date: date, exercise_id: ex, weight, reps })

  it('scores each set against its own exercise, so a squat and a curl count alike', () => {
    const sets = [set(TODAY, 'squat', 315, 5), set(TODAY, 'curl', 30, 10)]
    const day = dailyStrength(sets, TODAY)
    assert.equal(day.get(TODAY), 2)
  })

  it('a heavier set counts for more, capped at 3; bodyweight compares reps', () => {
    const sets = [set(shift(TODAY, -7), 'bench', 135, 10), set(shift(TODAY, -3), 'bench', 135, 10), set(TODAY, 'bench', 405, 10),
      set(shift(TODAY, -2), 'dip', null, 10), set(TODAY, 'dip', null, 20)]
    const day = dailyStrength(sets, TODAY)
    // bench reference = median(1350, 1350, 4050) = 1350 → 3; dip reference = 15 → 20/15
    assert.equal(Math.round(day.get(TODAY)! * 100) / 100, Math.round((3 + 20 / 15) * 100) / 100)
  })

  /** `perSession(week)` sets of the same two lifts every day for `weeks` weeks. */
  function history(weeks: number, perSession: (w: number) => number, weight = (_w: number) => 135): StrengthSet[] {
    const out: StrengthSet[] = []
    for (let d = weeks * 7 - 1; d >= 0; d--) {
      const w = Math.floor((weeks * 7 - 1 - d) / 7)
      for (let i = 0; i < perSession(w); i++) out.push(set(shift(TODAY, -d), i % 2 ? 'row' : 'bench', weight(w), 8))
    }
    return out
  }

  it('needs two weeks of history', () => {
    assert.equal(strengthLoad(history(1, () => 6), TODAY), null)
    assert.ok(strengthLoad(history(3, () => 6), TODAY))
  })

  it('a big jump with recovery falling says go lighter', () => {
    const sets = history(5, w => (w >= 4 ? 9 : 6))
    const calm = strengthLoad(sets, TODAY, {})!
    assert.equal(calm.band, 'high')
    assert.equal(calm.advice, null)
    const tired = strengthLoad(sets, TODAY, { restingDelta: 5 })!
    assert.equal(tired.advice, 'deload')
    assert.equal(tired.headline, 'Go lighter')
    assert.match(tired.sentence, /resting heart rate is 5 bpm over/)
    assert.ok(strengthScore(tired) <= strengthScore(calm) - 30)
  })

  it('three steady weeks, no gains and good recovery says room to push', () => {
    const sets = history(6, () => 6)
    const r = strengthLoad(sets, TODAY, { restingDelta: 0, hrvWeekZ: 0.2 })!
    assert.equal(r.advice, 'push')
    assert.equal(r.headline, 'Room to push')
    // Not without recovery evidence, and not when weights went up.
    assert.equal(strengthLoad(sets, TODAY, {})!.advice, null)
    const rising = history(6, () => 6, w => 135 + w * 10)
    assert.equal(strengthLoad(rising, TODAY, { restingDelta: 0 })!.advice, null)
  })

  it('stalled() needs two lifts compared and no 1% gain', () => {
    const flat = history(6, () => 4)
    assert.equal(stalled(flat, TODAY), true)
    assert.equal(stalled(history(6, () => 4, w => 100 + w * 5), TODAY), false)
    assert.ok(Math.abs(e1rm(100, 10) - 133.33) < 0.01)
  })

  it('names the falling recovery signal, most telling first', () => {
    assert.match(fallingRecovery({ hrvWeekZ: -0.8, restingDelta: 4 })!, /HRV/)
    assert.match(fallingRecovery({ restingDelta: 4 })!, /resting heart rate/)
    assert.match(fallingRecovery({ bbToday: 40, bbUsual: 70 })!, /Body Battery/)
    assert.equal(fallingRecovery({ restingDelta: 1, hrvZ: -0.3 }), null)
  })
})

describe('Charge with the new inputs', () => {
  const days: DailyBody[] = Array.from({ length: 10 }, (_, i) => ({
    local_date: shift(TODAY, i - 9), bb_high: 80, bb_low: 20, bb_latest: 50, bb_wake: 80, stress_avg: 25,
    resting_hr: 52, recovery_hours: 0,
  }))
  const checks = (today: number): ReadinessCheck[] => [
    ...Array.from({ length: 8 }, (_, i) => ({ local_date: shift(TODAY, -(i + 1)), measured_at: `${shift(TODAY, -(i + 1))}T06:30:00Z`, rmssd: 55 + (i % 3) * 3, ln_rmssd: Math.log(55 + (i % 3) * 3), mean_hr: 52, quality: 'good' as const })),
    { local_date: TODAY, measured_at: `${TODAY}T06:30:00Z`, rmssd: today, ln_rmssd: Math.log(today), mean_hr: 56, quality: 'good' },
  ]

  it('adds the HRV check, and a low morning lowers Charge', () => {
    const usual = computeCharge(days, [], TODAY, { readiness: checks(58) })!
    const low = computeCharge(days, [], TODAY, { readiness: checks(32) })!
    assert.ok(usual.inputs.some(i => i.key === 'hrv' && i.value === '58 ms'))
    assert.ok(low.score < usual.score - 10)
    assert.match(low.advice, /HRV is under your usual/)
  })

  it('without readiness checks it is unchanged in shape', () => {
    const c = computeCharge(days, [], TODAY)!
    assert.equal(c.inputs.some(i => i.key === 'hrv'), false)
    const w = c.inputs.reduce((s, i) => s + i.weight, 0)
    assert.ok(Math.abs(w - 1) < 1e-9)
  })
})
