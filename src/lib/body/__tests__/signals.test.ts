import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { bbGain, computeSignals, signalTrackRecord, type DailyBody } from '..'

const TODAY = '2026-11-19'

function shift(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00`)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** A night: HR, stress, respiration and temperature flat through 00:00–06:00,
 *  and Body Battery climbing from `bbLow` by `gain` across the morning. */
function night(date: string, o: { hr?: number; stress?: number; resp?: number; temp?: number; bbLow?: number; gain?: number } = {}): DailyBody {
  const flat = (v: number | undefined) => (v == null ? null : Array.from({ length: 96 }, (_, i) => (i < 24 ? v : null)))
  const low = o.bbLow ?? 20
  const gain = o.gain ?? 50
  const bb = Array.from({ length: 96 }, (_, i) => (i < 32 ? Math.round(low + (gain * i) / 31) : null))
  return {
    local_date: date,
    bb_high: null, bb_low: null, bb_latest: null, bb_wake: null,
    stress_avg: null, resting_hr: null, recovery_hours: null,
    hr_series: flat(o.hr ?? 58),
    stress_series: flat(o.stress ?? 12),
    resp_series: flat(o.resp ?? 15),
    temp_series: flat(o.temp == null ? 330 : o.temp),
    bb_series: bb,
  }
}

/** 14 ordinary nights with a little wobble, then `last` as tonight. */
function history(last: Parameters<typeof night>[1], prevNight?: Parameters<typeof night>[1]): DailyBody[] {
  const out: DailyBody[] = []
  for (let i = 14; i >= 1; i--) {
    const w = i % 3 - 1
    out.push(night(shift(TODAY, -i), { hr: 58 + w, stress: 12 + 2 * w, resp: 15 + 0.3 * w, gain: 50 + 4 * w }))
  }
  if (prevNight) out[out.length - 1] = night(shift(TODAY, -1), prevNight)
  out.push(night(TODAY, last))
  return out
}

describe('body signals', () => {
  it('is clear on an ordinary night', () => {
    const s = computeSignals(history({}), TODAY)
    assert.equal(s.level, 'clear')
    assert.equal(s.short, null)
  })

  it('is strong when heart rate, stress and recharge all move together', () => {
    const s = computeSignals(history({ hr: 70, stress: 35, gain: 12 }), TODAY)
    assert.equal(s.level, 'strong')
    assert.equal(s.signals[0].off, true)
    assert.match(s.advice, /skip hard training/)
    assert.ok(s.short && s.short.length <= 20)
  })

  it('is mild with two signals off', () => {
    const s = computeSignals(history({ hr: 63, resp: 16.2 }), TODAY)
    assert.equal(s.level, 'mild')
    assert.equal(s.signals.filter(x => x.off).length, 2)
  })

  it('one signal alone is not a warning', () => {
    assert.equal(computeSignals(history({ stress: 40 }), TODAY).level, 'clear')
  })

  it('temperature only backs up another signal', () => {
    assert.equal(computeSignals(history({ temp: 360 }), TODAY).level, 'clear')
    assert.equal(computeSignals(history({ temp: 360, hr: 63 }), TODAY).level, 'mild')
  })

  it('heart rate up two nights running warns on its own', () => {
    const s = computeSignals(history({ hr: 64 }, { hr: 64 }), TODAY)
    assert.equal(s.hrTwoNights, true)
    assert.equal(s.level, 'mild')
  })

  it('learns for the first seven nights', () => {
    const days = history({ hr: 75, stress: 40 }).slice(-5)
    const s = computeSignals(days, TODAY)
    assert.equal(s.level, 'learning')
    assert.match(s.advice, /7 nights/)
  })

  it('names a hard session the day before as a possible cause', () => {
    const sessions = [{ local_date: shift(TODAY, -1), started_at: '2026-11-18T22:00:00Z', completed_at: '2026-11-18T23:00:00Z', zone_seconds: [0, 0, 600, 900, 600] }]
    const s = computeSignals(history({ hr: 63, resp: 16.2 }), TODAY, { sessions })
    assert.deepEqual(s.explanations, ['25 min in zones 4–5 yesterday'])
    assert.match(s.advice, /could also be 25 min/)
  })

  it('says what you noted about the morning', () => {
    const s = computeSignals(history({ hr: 63, resp: 16.2 }), TODAY, { labels: [{ local_date: TODAY, tags: ['alcohol'] }] })
    assert.deepEqual(s.labels, ['alcohol'])
    assert.match(s.advice, /You noted you had a drink/)
  })

  it('uses imported overnight HRV when there is one', () => {
    const hrv = new Map<string, number>()
    for (let i = 14; i >= 1; i--) hrv.set(shift(TODAY, -i), 42 + (i % 3))
    hrv.set(TODAY, 34)
    const s = computeSignals(history({ hr: 63 }), TODAY, { overnightHrv: hrv })
    assert.equal(s.signals.find(x => x.key === 'overnight_hrv')?.off, true)
    assert.equal(s.level, 'mild')
  })

  it('counts flagged mornings and the ones you said were sickness', () => {
    const days = history({ hr: 70, stress: 35, gain: 12 })
    const r = signalTrackRecord(days, TODAY, { labels: [{ local_date: TODAY, tags: ['sick'] }] })
    assert.deepEqual(r, { flagged: 1, labelled: 1, sick: 1 })
  })
})

describe('bbGain', () => {
  it('measures from the evening low to the morning peak', () => {
    const prev = night(shift(TODAY, -1))
    prev.bb_series = Array.from({ length: 96 }, (_, i) => (i >= 84 ? 15 : null))
    assert.equal(bbGain(night(TODAY, { bbLow: 20, gain: 40 }), prev), 45)
  })

  it('needs a morning', () => {
    const row = night(TODAY)
    row.bb_series = Array.from({ length: 96 }, () => null)
    assert.equal(bbGain(row, undefined), null)
  })
})
