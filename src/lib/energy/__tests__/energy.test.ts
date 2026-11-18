import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { SleepSession } from '@/lib/health/model'
import { shiftDate } from '@/lib/health/model'
import { localToIso } from '@/lib/health/importers'
import {
  MAX_CALIBRATION_H,
  alertness,
  calibrationOffset,
  circadianPhase,
  debtWeights,
  phaseTimes,
  sleepDebt,
} from '../model'
import { sleepNeed } from '../sleepNeed'
import { buildEnergySchedule, nightsFrom } from '../schedule'
import { clockHoursFrom, instantAt } from '../time'
import { phaseAt } from '../now'
import { buildNights } from '../nights'
import { recoveryFor } from '../recovery'
import type { Night } from '../types'

const ZONE = 'America/New_York'
const TODAY = '2026-11-17'

function session(wakeDate: string, onset: string, wake: string, hours: number, zone = ZONE): SleepSession {
  const start = localToIso(`${shiftDate(wakeDate, onset >= '12:00' ? -1 : 0)}T${onset}:00`, zone)!
  const end = localToIso(`${wakeDate}T${wake}:00`, zone)!
  return {
    provider_id: `n-${wakeDate}`,
    source: 'garmin',
    device_id: 'd',
    wake_date: wakeDate,
    provider_date: wakeDate,
    timezone: zone,
    start_at: start,
    end_at: end,
    kind: 'main',
    duration_seconds: Math.round(hours * 3600),
    score: null,
    stages: null,
    stage_totals: null,
    overnight_hrv: null,
    respiration: null,
    spo2: null,
    revision_at: end,
    received_at: end,
    status: 'final',
  }
}

/** `count` nights ending today, same times every night. */
function regular(count: number, onset = '23:00', wake = '07:00', hours = 8, zone = ZONE) {
  return Array.from({ length: count }, (_, i) => session(shiftDate(TODAY, -i), onset, wake, hours, zone))
}

const hourOf = (iso: string) => clockHoursFrom(TODAY, iso, ZONE)
const event = (s: NonNullable<ReturnType<typeof buildEnergySchedule>>, kind: string) =>
  s.events.find((e) => e.kind === kind)!

describe('time helpers', () => {
  it('round-trips clock hours, including the evening before', () => {
    for (const h of [-1, 0, 7.25, 15.5, 23.75, 26]) {
      assert.ok(Math.abs(clockHoursFrom(TODAY, instantAt(TODAY, h, ZONE), ZONE) - h) < 1e-6)
    }
  })

  it('reads a DST-change night as wall clock, not elapsed time', () => {
    // US clocks fell back on 2026-11-01: 23:00 → 07:00 is 9 real hours but 8 on the clock.
    const s = session('2026-11-01', '23:00', '07:00', 8)
    const [n] = nightsFrom([s], '2026-11-01')
    assert.equal(n.onset, -1)
    assert.equal(n.wake, 7)
  })
})

describe('sleep debt', () => {
  it('weights last night 15% and the rest 85%', () => {
    const w = debtWeights(14)
    assert.equal(w[0], 0.15)
    assert.ok(Math.abs(w.reduce((a, b) => a + b, 0) - 1) < 1e-9)
    assert.ok(w[1] > w[13])
  })

  it('is zero when you sleep your need and grows with short nights', () => {
    const nights: Night[] = Array.from({ length: 14 }, (_, i) => ({ wakeDate: shiftDate(TODAY, -i), onset: -1, wake: 7, sleepH: 8 }))
    assert.equal(sleepDebt(nights, 8), 0)
    const short = nights.map((n) => ({ ...n, sleepH: 7 }))
    assert.ok(Math.abs(sleepDebt(short, 8) - 14) < 1e-9)
  })
})

describe('sleep need', () => {
  it('stays near 8h for a steady 8h sleeper and is clamped', () => {
    const nights = Array.from({ length: 14 }, (_, i) => ({ wakeDate: shiftDate(TODAY, -i), onset: -1, wake: 7, sleepH: 8 }))
    assert.ok(Math.abs(sleepNeed(nights) - 8) < 0.01)
    assert.ok(sleepNeed(nights.map((n) => ({ ...n, sleepH: 13 }))) <= 10)
    assert.equal(sleepNeed([]), 8)
  })
})

describe('circadian phase', () => {
  it('puts DLMO near 21:00 for a 23:00–07:00 sleeper', () => {
    const p = circadianPhase(nightsFrom(regular(14), TODAY))!
    assert.ok(Math.abs(p.dlmo - 21) < 0.1, `dlmo ${p.dlmo}`)
  })

  it('caps and shrinks felt-energy calibration', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ date: shiftDate(TODAY, -i), hour: 17.9, feeling: -1 as const }))
    assert.ok(Math.abs(calibrationOffset(21, many)) <= MAX_CALIBRATION_H)
    const one = [{ date: TODAY, hour: 16, feeling: -1 as const }]
    assert.ok(calibrationOffset(21, one) > 0 && calibrationOffset(21, one) < 1)
    assert.equal(calibrationOffset(21, [{ date: TODAY, hour: 16, feeling: 1 }]), 0)
  })
})

describe('energy schedule', () => {
  const s = buildEnergySchedule({ date: TODAY, timezone: ZONE, sessions: regular(14) })!

  it('lands the phases where the literature puts them', () => {
    const dip = event(s, 'afternoon_dip')
    const dipMid = (hourOf(dip.start) + hourOf(dip.end!)) / 2
    assert.ok(dipMid >= 14 && dipMid <= 16, `dip ${dipMid}`)
    const morning = hourOf(event(s, 'morning_peak').start)
    assert.ok(morning >= 8.5 && morning <= 11, `morning ${morning}`)
    const evening = event(s, 'evening_peak')
    assert.ok(hourOf(evening.end!) >= 17.5 && hourOf(evening.start) <= 20.5, 'evening peak')
    assert.ok(Math.abs(hourOf(event(s, 'wind_down').start) - 21) < 0.1)
    assert.ok(Math.abs(hourOf(event(s, 'bedtime').start) - 22.75) < 0.1)
    assert.ok(Math.abs(hourOf(event(s, 'grogginess_end').start) - 8.5) < 0.1)
  })

  it('orders the events through the day', () => {
    const starts = s.events.map((e) => Date.parse(e.start))
    assert.deepEqual([...starts].sort((a, b) => a - b), starts)
  })

  it('is confident with two regular weeks and not provisional when last night is in', () => {
    assert.equal(s.confidence, 'high')
    assert.equal(s.provisional, false)
    assert.equal(s.debtMin, 0)
    assert.equal(s.curve.length, 96)
    assert.equal(s.curve[0], null)
  })

  it('shifts every event with a later chronotype', () => {
    const late = buildEnergySchedule({ date: TODAY, timezone: ZONE, sessions: regular(14, '01:00', '09:00') })!
    for (const kind of ['morning_peak', 'afternoon_dip', 'wind_down', 'bedtime']) {
      const shift = hourOf(event(late, kind).start) - hourOf(event(s, kind).start)
      assert.ok(Math.abs(shift - 2) < 0.6, `${kind} shifted ${shift}`)
    }
  })

  it('deepens the dip and lowers the peaks with debt', () => {
    const rested = { wake: 7, dlmo: 21, debtH: 0 }
    const tired = { ...rested, debtH: 8 }
    const a = phaseTimes(rested)
    const b = phaseTimes(tired)
    assert.ok(alertness(tired, b.dip[0]) < alertness(rested, a.dip[0]))
    const swing = (d: typeof rested, t: typeof a) =>
      alertness(d, (t.morningPeak[0] + t.morningPeak[1]) / 2) - alertness(d, (t.dip[0] + t.dip[1]) / 2)
    assert.ok(swing(tired, b) > swing(rested, a))
  })

  it('has low confidence on two nights and goes provisional without last night', () => {
    const few = buildEnergySchedule({ date: TODAY, timezone: ZONE, sessions: regular(3).slice(1) })!
    assert.equal(few.confidence, 'low')
    assert.equal(few.provisional, true)
  })

  it('returns null with no sleep at all', () => {
    assert.equal(buildEnergySchedule({ date: TODAY, timezone: ZONE, sessions: [] }), null)
  })
})

describe('phaseAt', () => {
  const s = buildEnergySchedule({ date: TODAY, timezone: ZONE, sessions: regular(14) })!
  const at = (h: number) => Date.parse(instantAt(TODAY, h, ZONE))

  it('names the phase for each part of the day', () => {
    assert.equal(phaseAt(s, at(5)).state, 'before_wake')
    assert.equal(phaseAt(s, at(7.5)).state, 'grogginess_end')
    const dip = event(s, 'afternoon_dip')
    assert.equal(phaseAt(s, (Date.parse(dip.start) + Date.parse(dip.end!)) / 2).state, 'afternoon_dip')
    assert.equal(phaseAt(s, at(21.5)).state, 'wind_down')
    assert.equal(phaseAt(s, at(23.5)).state, 'past_bedtime')
  })

  it('points at the next boundary', () => {
    const r = phaseAt(s, at(12))
    assert.ok(r.next && r.next.at > at(12))
    assert.equal(phaseAt(s, at(23.9)).next, null)
  })
})

describe('watch signals', () => {
  const at = (date: string, hhmm: string) => localToIso(`${date}T${hhmm}:00`, ZONE)!
  const piece = (
    wakeDate: string,
    start: string,
    end: string,
    hours: number,
    extra: Partial<SleepSession> = {},
  ): SleepSession => ({
    ...session(wakeDate, '23:00', '07:00', hours),
    start_at: start,
    end_at: end,
    provider_id: `${start}-${extra.source ?? 'garmin'}`,
    ...extra,
  })

  it('stitches a broken night from two sources into one night without double counting', () => {
    // Real shape from 2026-11-14: Apple saw both halves, Garmin only the second (and Apple
    // also filed that second half as a nap).
    const parts = [
      piece(TODAY, at(TODAY, '03:59'), at(TODAY, '07:39'), 3.32, { source: 'apple_health' }),
      piece(TODAY, at(TODAY, '08:53'), at(TODAY, '12:18'), 3.2, { source: 'garmin_export' }),
      piece(TODAY, at(TODAY, '08:53'), at(TODAY, '12:18'), 3.2, { source: 'apple_health', kind: 'nap' }),
    ]
    const { nights, naps } = buildNights(parts, TODAY)
    assert.equal(nights.length, 1)
    assert.equal(naps.length, 0)
    const n = nights[0]
    assert.equal(n.pieces, 2)
    assert.ok(Math.abs(n.onset - (3 + 59 / 60)) < 0.02)
    assert.ok(Math.abs(n.wake - (12 + 18 / 60)) < 0.02)
    assert.ok(Math.abs(n.sleepH - 6.52) < 0.01, `slept ${n.sleepH}`)
  })

  it('treats a daytime nap as a nap: pays debt, leaves phase alone, blanks the curve', () => {
    const nap = piece(TODAY, at(TODAY, '14:00'), at(TODAY, '14:40'), 0.6, { kind: 'nap' })
    const base = buildEnergySchedule({ date: TODAY, timezone: ZONE, sessions: [...regular(14, '23:00', '07:00', 7)] })!
    const withNap = buildEnergySchedule({ date: TODAY, timezone: ZONE, sessions: [...regular(14, '23:00', '07:00', 7), nap] })!
    assert.ok(withNap.debtMin < base.debtMin)
    assert.equal(withNap.dlmoAt, base.dlmoAt)
    assert.equal(withNap.curve[14 * 4 + 1], null)
    assert.ok(withNap.signals.some((s) => s.key === 'nap'))
    // Sleep pressure recovered: later afternoon sits higher than without the nap.
    const i = 17 * 4
    assert.ok((withNap.curve[i] ?? 0) > (base.curve[i] ?? 0))
  })

  it('a day with only a nap on record is not mistaken for a night', () => {
    const nap = piece(TODAY, at(TODAY, '15:00'), at(TODAY, '15:45'), 0.7, { kind: 'nap' })
    const { nights, naps } = buildNights([nap], TODAY)
    assert.equal(nights.length, 0)
    assert.equal(naps.length, 1)
  })

  it('needs 7 earlier readings before HRV counts, then caps its effect', () => {
    const few = regular(4).map((s, i) => ({ ...s, overnight_hrv: i === 0 ? 10 : 45 }))
    assert.equal(recoveryFor(TODAY, buildNights(few, TODAY).nights, []).parts.length, 0)

    const many = regular(14).map((s, i) => ({ ...s, overnight_hrv: i === 0 ? 1 : 40 + (i % 5) }))
    const r = recoveryFor(TODAY, buildNights(many, TODAY).nights, [])
    assert.equal(r.parts.length, 1)
    assert.ok(r.debtEquivH > 0 && r.debtEquivH <= 1.5 + 1e-9)
  })

  it('averages sensors so agreement never stacks past one sensor at its cap', () => {
    const nights = buildNights(
      regular(14).map((s, i) => ({ ...s, overnight_hrv: i === 0 ? 1 : 40 + (i % 5) })),
      TODAY,
    ).nights
    const days = Array.from({ length: 14 }, (_, i) => ({
      date: shiftDate(TODAY, -i),
      bbWake: i === 0 ? 5 : 70 + (i % 4),
      restingHr: i === 0 ? 90 : 50 + (i % 3),
    }))
    const one = recoveryFor(TODAY, nights, [])
    const three = recoveryFor(TODAY, nights, days)
    assert.equal(three.parts.length, 3)
    assert.ok(three.debtEquivH <= one.debtEquivH + 1e-9)
  })

  it('poor recovery lowers the curve but never moves the clock', () => {
    const plain = regular(14)
    const lowHrv = plain.map((s, i) => ({ ...s, overnight_hrv: i === 0 ? 20 : 45 + (i % 4) }))
    const a = buildEnergySchedule({ date: TODAY, timezone: ZONE, sessions: plain })!
    const b = buildEnergySchedule({ date: TODAY, timezone: ZONE, sessions: lowHrv })!
    assert.equal(b.dlmoAt, a.dlmoAt)
    assert.equal(event(b, 'wind_down').start, event(a, 'wind_down').start)
    assert.equal(event(b, 'bedtime').start, event(a, 'bedtime').start)
    const dipMid = (s: typeof a) => (hourOf(event(s, 'afternoon_dip').start) + hourOf(event(s, 'afternoon_dip').end!)) / 2
    assert.ok(Math.abs(dipMid(b) - dipMid(a)) < 0.34, 'dip may sharpen, not wander')
    assert.ok(Math.max(...b.curve.map((v) => v ?? 0)) < Math.max(...a.curve.map((v) => v ?? 0)))
    assert.ok(b.signals.some((s) => s.key === 'recovery'))
  })

  it('waking from deep sleep stretches grogginess and nothing else', () => {
    const plain = regular(14)
    const deep = plain.map((s, i) =>
      i === 0
        ? { ...s, stages: [{ stage: 'deep' as const, start: at(TODAY, '06:20'), end: s.end_at }] }
        : s,
    )
    const a = buildEnergySchedule({ date: TODAY, timezone: ZONE, sessions: plain })!
    const b = buildEnergySchedule({ date: TODAY, timezone: ZONE, sessions: deep })!
    const groggy = (s: typeof a) => hourOf(event(s, 'grogginess_end').start)
    assert.ok(groggy(b) - groggy(a) > 0.6 && groggy(b) - groggy(a) < 1)
    assert.equal(event(b, 'wind_down').start, event(a, 'wind_down').start)
    assert.ok(b.signals.some((s) => s.key === 'wake_stage'))
  })

  it('adds no signals when the watch had nothing to say', () => {
    assert.deepEqual(buildEnergySchedule({ date: TODAY, timezone: ZONE, sessions: regular(14) })!.signals, [])
  })
})
