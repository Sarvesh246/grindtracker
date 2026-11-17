import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeCharge,
  dayStory,
  fitterLine,
  heartSentence,
  loadBalance,
  loadScore,
  restingBaseline,
  sessionLoad,
  zoneOf,
  type DailyBody,
  type DatedHrSet,
  type LoadSession,
} from '..'

const TODAY = '2026-11-16'

function day(date: string, over: Partial<DailyBody> = {}): DailyBody {
  return {
    local_date: date,
    bb_high: null, bb_low: null, bb_latest: null, bb_wake: null,
    stress_avg: null, resting_hr: null, recovery_hours: null,
    ...over,
  }
}

function daysAgo(n: number): string {
  const d = new Date(`${TODAY}T12:00:00`)
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function session(ageDays: number, zoneSeconds: number[] | null, minutes = 60): LoadSession {
  const date = daysAgo(ageDays)
  const start = new Date(`${date}T18:00:00Z`)
  return {
    local_date: date,
    started_at: start.toISOString(),
    completed_at: new Date(start.getTime() + minutes * 60_000).toISOString(),
    zone_seconds: zoneSeconds,
  }
}

describe('load', () => {
  it('weights minutes by zone', () => {
    assert.equal(sessionLoad(session(0, [60, 60, 60, 60, 60])), 15)
  })
  it('falls back to zone-2 minutes without a trace, capped', () => {
    assert.equal(sessionLoad(session(0, null, 45)), 90)
    assert.equal(sessionLoad(session(0, null, 600)), 300)
  })
  it('needs two weeks of history', () => {
    assert.equal(loadBalance([session(1, null), session(5, null)], TODAY), null)
  })
  it('puts a steady month in the sweet spot', () => {
    const s = [0, 3, 7, 10, 14, 17, 21, 24].map(a => session(a, null))
    const lb = loadBalance(s, TODAY)!
    assert.equal(lb.band, 'building')
    assert.equal(lb.percent, 0)
  })
  it('flags a sharp ramp', () => {
    const s = [0, 1, 2, 3, 4, 5, 20].map(a => session(a, null))
    assert.equal(loadBalance(s, TODAY)!.band, 'high')
  })
  it('scores the sweet spot full and falls off either side', () => {
    assert.equal(loadScore(1), 100)
    assert.ok(loadScore(0.4) < 60)
    assert.equal(loadScore(1.8), 0)
  })
})

describe('charge', () => {
  it('shows nothing with fewer than two inputs', () => {
    assert.equal(computeCharge([day(TODAY, { bb_high: 80 })], [], TODAY), null)
    assert.equal(computeCharge([], [], TODAY), null)
  })
  it('ignores yesterday\'s row for today', () => {
    assert.equal(computeCharge([day(daysAgo(1), { bb_high: 80, recovery_hours: 0 })], [], TODAY), null)
  })
  it('re-weights the inputs it has', () => {
    const c = computeCharge([day(TODAY, { bb_wake: 80, recovery_hours: 0 })], [], TODAY)!
    // 80 * 0.4/0.65 + 100 * 0.25/0.65
    assert.equal(c.score, Math.round((80 * 0.4 + 100 * 0.25) / 0.65))
    assert.equal(c.band, 'primed')
    assert.match(c.advice, /^Primed\. /)
    assert.ok(Math.abs(c.inputs.reduce((s, i) => s + i.weight, 0) - 1) < 1e-9)
  })
  it('names the weakest input on an easy day', () => {
    const days = [day(TODAY, { bb_wake: 30, recovery_hours: 40, resting_hr: 64 })]
    for (let i = 1; i <= 10; i++) days.push(day(daysAgo(i), { resting_hr: 58 }))
    const c = computeCharge(days, [], TODAY)!
    assert.equal(c.band, 'easy')
    assert.match(c.advice, /^Easy\. Resting heart rate is 6 bpm over your usual/)
    assert.equal(c.shortAdvice, 'Trim a set per lift')
  })
  it('needs five days for a resting HR baseline', () => {
    const days = [1, 2, 3, 4].map(i => day(daysAgo(i), { resting_hr: 60 }))
    assert.equal(restingBaseline(days, TODAY), null)
    days.push(day(daysAgo(5), { resting_hr: 55 }))
    assert.equal(restingBaseline(days, TODAY), 59)
  })
})

describe('getting fitter', () => {
  const set = (date: string, peak: number, weight = 185, reps = 8): DatedHrSet => ({
    local_date: date, exercise_id: 'e', set_number: 1, weight, reps, hr_peak: peak, hr_end: null, hr_rest_drop_60: null,
  })
  it('speaks when recent sets are clearly easier', () => {
    const sets = [
      set(daysAgo(0), 140), set(daysAgo(0), 142), set(daysAgo(2), 141),
      set(daysAgo(40), 155), set(daysAgo(40), 153), set(daysAgo(42), 154),
    ]
    const f = fitterLine(sets, w => `${w} lbs`)!
    assert.equal(f.deltaBpm, 13)
    assert.match(f.sentence, /^Same weight, 13 bpm easier than /)
    assert.equal(f.label, '185 lbs × 8')
  })
  it('stays quiet without three comparable sets on each side', () => {
    const sets = [set(daysAgo(0), 140), set(daysAgo(0), 142), set(daysAgo(2), 141), set(daysAgo(40), 155), set(daysAgo(40), 153)]
    assert.equal(fitterLine(sets), null)
  })
  it('ignores sets at a different weight', () => {
    const sets = [
      set(daysAgo(0), 140), set(daysAgo(0), 142), set(daysAgo(2), 141),
      set(daysAgo(40), 155, 135), set(daysAgo(40), 153, 135), set(daysAgo(42), 154, 135),
    ]
    assert.equal(fitterLine(sets), null)
  })
  it('stays quiet under a 3 bpm difference', () => {
    const sets = [
      set(daysAgo(0), 150), set(daysAgo(0), 151), set(daysAgo(2), 150),
      set(daysAgo(40), 152), set(daysAgo(40), 151), set(daysAgo(42), 152),
    ]
    assert.equal(fitterLine(sets), null)
  })
})

describe('workout heart', () => {
  it('maps a heart rate to the user\'s zones', () => {
    const z = [106, 127, 148, 169, 190, 211]
    assert.equal(zoneOf(100, z), 0)
    assert.equal(zoneOf(130, z), 2)
    assert.equal(zoneOf(170, z), 4)
    assert.equal(zoneOf(195, z), 5)
    assert.equal(zoneOf(150, null), 0)
  })
  it('names the hardest set and the best recovery', () => {
    const s = (id: string, name: string, n: number, peak: number, drop: number) => ({
      exercise_id: id, exercise_name: name, set_number: n, weight: 100, reps: 8, hr_peak: peak, hr_end: null, hr_rest_drop_60: drop,
    })
    const out = heartSentence([s('a', 'Squat', 1, 160, 20), s('a', 'Squat', 3, 171, 22), s('b', 'Leg Press', 1, 150, 35), s('b', 'Leg Press', 2, 152, 33)])
    assert.equal(out, 'Hardest set: squat set 3 at 171 bpm. You recovered fastest between leg press sets.')
  })
})

describe('day story', () => {
  it('tells the morning, the stress, the workout and now', () => {
    const bb: (number | null)[] = Array(96).fill(null)
    for (let i = 28; i < 80; i++) bb[i] = 86 - Math.floor((i - 28) / 2)
    const stress: (number | null)[] = Array(96).fill(20)
    for (let i = 48; i < 64; i++) stress[i] = 70
    const row = day(TODAY, { bb_series: bb, stress_series: stress, bb_latest: 36 })
    const start = new Date(`${TODAY}T17:30:00`)
    const end = new Date(start.getTime() + 60 * 60_000)
    const lines = dayStory(row, [{ name: 'Pull', started_at: start.toISOString(), completed_at: end.toISOString() }], true)
    assert.deepEqual(lines.map(l => l.time), ['7a', '12–4p', '5:30p', 'now'])
    assert.equal(lines[0].lead, 'Woke at 86')
    assert.match(lines[2].lead, /^Pull cost \d+ points$/)
    assert.equal(lines[3].lead, 'At 36')
  })
})
