import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { computeFitnessAge, cooperVo2, vdot, type FitnessDay, type LiftSet } from '../fitnessAge'
import { detectFieldTests, effectiveCalibrations, type Calibration } from '../fitnessAge/calibration'
import { cardioAge, flagNights, shiftDate } from '../fitnessAge/cardio'
import { ageForVo2, ageForZ, liftKind, vo2Median, vo2Sd } from '../fitnessAge/norms'
import { recoveryAge } from '../fitnessAge/recoveryAge'
import { strengthAge } from '../fitnessAge/strengthAge'
import { validateCalibration, validateProfile } from '../fitnessAge/validate'

const TODAY = '2026-11-24'
const BIRTH_18 = '2008-06-01'

function series(n: number, f: (i: number, date: string) => Partial<FitnessDay>): FitnessDay[] {
  return Array.from({ length: n }, (_, i) => {
    const date = shiftDate(TODAY, i - n + 1)
    return { date, ...f(i, date) }
  })
}

describe('norms', () => {
  it('inverts the VO2 curve and clamps to 18–90', () => {
    assert.equal(ageForVo2('male', 70), 18)
    assert.equal(ageForVo2('male', 10), 90)
    assert.ok(Math.abs(ageForVo2('male', vo2Median('male', 45)) - 45) < 0.05)
    assert.ok(ageForVo2('female', 35) > ageForVo2('female', 40))
  })
  it('uses 20 years per SD for z-ages, clamped', () => {
    assert.equal(ageForZ(40, 0.5), 30)
    assert.equal(ageForZ(18, 2), 18)
    assert.equal(ageForZ(80, -2), 90)
  })
  it('maps barbell lifts and skips variants that change the load', () => {
    assert.equal(liftKind('Back Squat'), 'squat')
    assert.equal(liftKind('Bench Press'), 'bench')
    assert.equal(liftKind('Conventional Deadlift'), 'deadlift')
    assert.equal(liftKind('OHP'), 'press')
    assert.equal(liftKind('Romanian Deadlift'), null)
    assert.equal(liftKind('Dumbbell Bench Press'), null)
    assert.equal(liftKind('Leg Press'), null)
    assert.equal(liftKind('Bicep Curl'), null)
  })
})

describe('calibration math', () => {
  it('matches the Daniels VDOT and Cooper equations', () => {
    const v = vdot(5000, 20 * 60)!
    assert.ok(v > 49 && v < 51, `20:00 5 km ≈ VDOT 50, got ${v}`)
    assert.ok(Math.abs(cooperVo2(2800) - 51.3) < 0.1)
  })
  it('auto-detects a hard 5 km, not a jog, a sick day or a treadmill run', () => {
    const base = { activity_type: 'running', distance_m: 5000, duration_seconds: 1260, max_hr: 200 }
    const acts = [
      { ...base, provider_id: 'hard', local_date: '2026-11-01', average_hr: 186 },
      { ...base, provider_id: 'jog', local_date: '2026-11-03', average_hr: 150 },
      { ...base, provider_id: 'sick', local_date: '2026-11-05', average_hr: 188 },
      { ...base, provider_id: 'tread', local_date: '2026-11-07', average_hr: 188, activity_type: 'treadmill_running' },
    ]
    const found = detectFieldTests(acts, 18, new Set(['2026-11-05']))
    assert.deepEqual(found.map(f => f.activity_id), ['hard'])
    assert.equal(found[0].sd, 2.5)
  })
  it('honours a rejected auto test and keeps manual ones', () => {
    const auto: Calibration = { measured_on: '2026-11-01', kind: 'run_5k', value: 50, source: 'auto', activity_id: 'a', status: 'accepted' }
    const stored: Calibration[] = [
      { ...auto, status: 'rejected' },
      { measured_on: '2026-10-01', kind: 'lab_cpet', value: 52, source: 'manual', status: 'accepted' },
    ]
    const eff = effectiveCalibrations(stored, [auto])
    assert.deepEqual(eff.map(c => c.kind), ['lab_cpet'])
    assert.equal(eff[0].sd, 2.0)
  })
})

describe('night flags', () => {
  it('flags tagged nights and big RHR / HRV swings against the baseline', () => {
    const days = series(30, i => ({ rhr: 55, hrv: 60, tagged: i === 20, ...(i === 25 ? { rhr: 62 } : {}), ...(i === 27 ? { hrv: 45 } : {}) }))
    const f = flagNights(days)
    assert.ok(f.flagged.has(days[20].date))
    assert.ok(f.flagged.has(days[25].date))
    assert.ok(f.flagged.has(days[27].date))
    assert.equal(f.flagged.size, 3)
  })
})

describe('cardio age', () => {
  const steady = (vo2: number, extra: (i: number) => Partial<FitnessDay> = () => ({})) =>
    series(180, i => ({ vo2: i % 3 === 0 ? vo2 : null, rhr: 58, hrv: 60, active: i % 2 === 0, ...extra(i) }))

  it('undoes Garmin’s pull toward 50 in both directions', () => {
    // A true 40 reads (1−0.12)·40 + 6 = 41.2; a true 65 reads 63.2. Resting HR
    // is set to match each truth, as it would be in life.
    const low = cardioAge({ sex: 'male', age: 45, sport: 'running', today: TODAY, days: steady(41.2, () => ({ rhr: 62.2 })), anchors: [] })!
    assert.ok(Math.abs(low.vo2 - 40) < 1.5, `vo2 ${low.vo2}`)
    const high = cardioAge({ sex: 'male', age: 18.4, sport: 'running', today: TODAY, days: steady(63.2, () => ({ rhr: 56.9 })), anchors: [] })!
    assert.ok(high.vo2 > 63.2, `vo2 ${high.vo2}`)
    assert.equal(low.confidence, 'uncalibrated')
    assert.ok(low.range[0] < low.age && low.age < low.range[1])
  })
  it('sits at the 18 floor for a very fit 18-year-old and still reports a percentile', () => {
    const r = cardioAge({ sex: 'male', age: 18.4, sport: 'running', today: TODAY, days: steady(64), anchors: [] })!
    assert.equal(r.age, 18)
    assert.equal(r.atPeak, true)
    assert.ok(r.percentile > 80)
  })
  it('lets a field test override a biased watch and says so', () => {
    const anchors: Calibration[] = [{ measured_on: shiftDate(TODAY, -10), kind: 'run_5k', value: 46, source: 'manual', status: 'accepted', sd: 2.5 }]
    const r = cardioAge({ sex: 'male', age: 18.4, sport: 'running', today: TODAY, days: steady(54), anchors })!
    assert.ok(r.vo2 < 50, `vo2 ${r.vo2}`)
    assert.equal(r.confidence, 'calibrated')
    assert.ok(r.surprise?.garminReadsHigh)
    assert.ok(r.garminBias > 2)
  })
  it('ignores readings from flagged nights', () => {
    const clean = cardioAge({ sex: 'male', age: 30, sport: 'running', today: TODAY, days: steady(50), anchors: [] })!
    const sick = cardioAge({ sex: 'male', age: 30, sport: 'running', today: TODAY,
      days: steady(50, i => (i % 21 === 0 ? { vo2: 40, tagged: true } : {})), anchors: [] })!
    assert.ok(Math.abs(sick.vo2 - clean.vo2) < 0.6)
  })
  it('decays after a habit stops, but not for someone who never trained', () => {
    const stopped = series(180, i => ({ vo2: i < 100 && i % 3 === 0 ? 50 : null, rhr: 58, active: i < 100 && i % 2 === 0 }))
    const never = series(180, i => ({ vo2: i < 100 && i % 30 === 0 ? 50 : null, rhr: 58, active: i < 100 && i % 30 === 0 }))
    const a = cardioAge({ sex: 'male', age: 30, sport: 'running', today: TODAY, days: stopped, anchors: [] })!
    const b = cardioAge({ sex: 'male', age: 30, sport: 'running', today: TODAY, days: never, anchors: [] })!
    assert.ok(a.vo2 < b.vo2 - 3, `${a.vo2} vs ${b.vo2}`)
  })
  it('raises mL/kg as weight falls between readings', () => {
    const days = series(180, i => ({ vo2: i < 90 && i % 3 === 0 ? 45 : null, rhr: 60, weightKg: 90 - (10 * i) / 179, active: true }))
    const r = cardioAge({ sex: 'male', age: 25, sport: 'running', today: TODAY, days, anchors: [] })!
    assert.ok(r.vo2 > 47, `vo2 ${r.vo2}`)
  })
  it('returns null with nothing to go on', () => {
    assert.equal(cardioAge({ sex: 'female', age: 30, sport: 'running', today: TODAY, days: [], anchors: [] }), null)
  })
})

describe('strength age', () => {
  const lifts = (squatLbs: number, start = 0): LiftSet[] => series(180, () => ({})).flatMap((d, i) =>
    i >= start && i % 3 === 0 ? [{ date: d.date, name: 'Squat', weight: squatLbs, reps: 5 }] : [])
  const weights = [{ date: shiftDate(TODAY, -179), lbs: 165 }]

  it('is null without lifts or grip', () => {
    assert.equal(strengthAge({ sex: 'male', age: 18, today: TODAY, sets: [], weights, anchors: [] }), null)
  })
  it('rates a strong squat younger than a weak one and stays uncalibrated', () => {
    const strong = strengthAge({ sex: 'male', age: 40, today: TODAY, sets: lifts(300), weights, anchors: [] })!
    const weak = strengthAge({ sex: 'male', age: 40, today: TODAY, sets: lifts(120), weights, anchors: [] })!
    assert.ok(strong.age < weak.age)
    assert.equal(strong.confidence, 'uncalibrated')
    assert.deepEqual(strong.lifts, ['squat'])
  })
  it('anchors to grip and narrows the range', () => {
    const grip: Calibration = { measured_on: shiftDate(TODAY, -30), kind: 'grip', value: 58, source: 'manual', status: 'accepted' }
    const plain = strengthAge({ sex: 'male', age: 40, today: TODAY, sets: lifts(200), weights, anchors: [] })!
    const anchored = strengthAge({ sex: 'male', age: 40, today: TODAY, sets: lifts(200), weights, anchors: [grip] })!
    assert.equal(anchored.confidence, 'calibrated')
    assert.ok(anchored.range[1] - anchored.range[0] < plain.range[1] - plain.range[0])
    assert.ok(anchored.age < plain.age, 'a strong grip pulls the age down')
  })
  it('discounts a beginner’s first-months jump', () => {
    const novice = series(180, () => ({})).flatMap((d, i) =>
      i >= 100 && i % 3 === 0 ? [{ date: d.date, name: 'Squat', weight: 100 + (i - 100), reps: 5 }] : [])
    const vet = lifts(179)
    const a = strengthAge({ sex: 'male', age: 45, today: TODAY, sets: novice, weights, anchors: [] })!
    const b = strengthAge({ sex: 'male', age: 45, today: TODAY, sets: vet, weights, anchors: [] })!
    assert.ok(a.age > b.age, `${a.age} vs ${b.age}`)
  })
})

describe('recovery age', () => {
  it('needs 10 nights and reads average nights as roughly your age', () => {
    const few = series(8, () => ({ rhr: 60, hrv: 58 }))
    assert.equal(recoveryAge({ sex: 'male', age: 20, today: TODAY, days: few, flags: flagNights(few) }), null)
    const days = series(28, () => ({ rhr: 60, hrv: 58 }))
    const r = recoveryAge({ sex: 'male', age: 20, today: TODAY, days, flags: flagNights(days) })!
    assert.ok(Math.abs(r.age - 20) < 1.5, `age ${r.age}`)
    assert.equal(r.nights, 28)
  })
  it('falls back to every night when too many are flagged', () => {
    const days = series(28, () => ({ rhr: 60, hrv: 58, tagged: true }))
    assert.ok(recoveryAge({ sex: 'female', age: 30, today: TODAY, days, flags: flagNights(days) }))
  })
})

describe('computeFitnessAge', () => {
  const days = series(180, i => ({ vo2: i % 3 === 0 ? 52 : null, rhr: 56, hrv: 65, active: i % 2 === 0 }))
  const input = { today: TODAY, days, activities: [], sets: [], weights: [], calibrations: [] }

  it('refuses under 18', () => {
    const r = computeFitnessAge({ ...input, profile: { birth_date: '2010-01-01', sex: 'male' } })
    assert.deepEqual(r, { ok: false, reason: 'under_18' })
  })
  it('works at 18 and renormalises GRIND age over the scores that exist', () => {
    const r = computeFitnessAge({ ...input, profile: { birth_date: BIRTH_18, sex: 'male' } })
    assert.ok(r.ok)
    if (!r.ok) return
    assert.equal(r.result.strength, null)
    assert.deepEqual(r.result.grind!.weights, { cardio: 0.79, recovery: 0.21 })
    assert.equal(r.result.calibrate.cardio, 'missing')
    assert.equal(r.result.calibrate.strength, 'missing')
    assert.ok(r.result.grind!.age >= 18)
  })
})

describe('validation', () => {
  it('accepts a valid profile and rejects bad ones', () => {
    assert.ok(validateProfile({ birth_date: BIRTH_18, sex: 'male', height_cm: 180 }, TODAY).ok)
    assert.ok(!validateProfile({ birth_date: BIRTH_18, sex: 'x' }, TODAY).ok)
    assert.ok(!validateProfile({ birth_date: '2030-01-01', sex: 'male' }, TODAY).ok)
    assert.ok(!validateProfile({ birth_date: BIRTH_18, sex: 'male', height_cm: 20 }, TODAY).ok)
  })
  it('turns field tests into VO2max and checks ranges', () => {
    const r = validateCalibration({ kind: 'run_5k', measured_on: '2026-11-01', seconds: 1200 }, TODAY)
    assert.ok(r.ok && r.value.type === 'manual' && Math.abs(r.value.row.value - 49.8) < 1)
    assert.ok(validateCalibration({ kind: 'grip', measured_on: '2026-11-01', kg: 52 }, TODAY).ok)
    assert.ok(!validateCalibration({ kind: 'grip', measured_on: '2026-11-01', kg: 500 }, TODAY).ok)
    assert.ok(!validateCalibration({ kind: 'lab_cpet', measured_on: '2027-01-01', vo2max: 50 }, TODAY).ok)
    assert.ok(validateCalibration({ activity_id: '123', measured_on: '2026-11-01', value: 50, status: 'rejected' }, TODAY).ok)
  })
})

describe('matches the stress-tested simulation', () => {
  // Seeded re-run of scenario S1 (18M runner) through the real implementation,
  // with the simulation's error model. It must land near the simulated ±3.0 y.
  let seed = 7
  const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
  const randn = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand())

  it('keeps 18M cardio-age error near the simulated 3 years', () => {
    let err = 0
    const N = 250
    for (let p = 0; p < N; p++) {
      const v = vo2Median('male', 18.4) + vo2Sd('male', 18.4) * randn()
      const bias = 2.6 * randn()
      let g: number | null = null
      const days = series(180, () => {
        const d: Partial<FitnessDay> = { rhr: 60 - 0.34 * (v - vo2Median('male', 18.4)) + 8.6 * 0 + 2.5 * randn(), hrv: 60 }
        if (rand() < 3 / 7) {
          const e = v + bias - 0.15 * (v - 50) + 2 * randn()
          g = g == null ? e : 0.75 * g + 0.25 * e
          d.vo2 = g; d.active = true
        }
        return d
      })
      const r = cardioAge({ sex: 'male', age: 18.4, sport: 'running', today: TODAY, days, anchors: [] })!
      err += Math.abs(r.age - ageForVo2('male', v))
    }
    const mae = err / N
    assert.ok(mae < 4, `mean absolute error ${mae.toFixed(2)} y`)
  })
})
