import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { summarizeCoachSleep } from '../bodyContext'
import { COACH_BODY_PROMPT } from '../prompt'
import type { SleepSession } from '../../health/model'

const TODAY = '2026-11-16'
const day = (offset: number) => {
  const d = new Date(`${TODAY}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}
const night = (offset: number, over: Partial<SleepSession> = {}): SleepSession => {
  const wake = day(offset)
  return {
    provider_id: `n${offset}`,
    source: 'garmin_personal',
    device_id: 'fr165',
    wake_date: wake,
    provider_date: wake,
    timezone: 'UTC',
    start_at: `${day(offset - 1)}T23:00:00Z`,
    end_at: `${wake}T07:00:00Z`,
    kind: 'main',
    duration_seconds: 7 * 3600,
    score: 80,
    stages: null,
    stage_totals: { awake: 1800, rem: 5400, light: 12600, deep: 5400 },
    overnight_hrv: 45,
    respiration: 14,
    spo2: null,
    revision_at: `${wake}T09:00:00Z`,
    received_at: `${wake}T09:00:00Z`,
    status: 'final',
    ...over
  }
}

describe('Coach sleep evidence', () => {
  it('is absent when nothing was imported', () => {
    assert.equal(summarizeCoachSleep([], TODAY), null)
  })

  it('reports last night with timing, stages, HRV and honest coverage', () => {
    const block = summarizeCoachSleep(
      [night(-2), night(-1), night(0, { overnight_hrv: 50 })],
      TODAY
    )!
    assert.equal(block.last_night?.wake_date, TODAY)
    assert.equal(block.last_night?.duration_min, 420)
    assert.equal(block.last_night?.woke_at_local, '7:00 AM')
    assert.deepEqual(block.last_night?.stage_minutes, { awake: 30, rem: 90, light: 210, deep: 90 })
    assert.equal(block.last_night?.overnight_hrv_ms, 50)
    assert.equal(block.nights_recorded_14d, 3)
    assert.equal(block.hrv_usual_range_ms, null) // fewer than 14 comparable nights
    assert.match(block.coverage, /3 of the last 14 nights/)
  })

  it('does not call an old record "last night"', () => {
    const block = summarizeCoachSleep([night(-6)], TODAY)!
    assert.equal(block.last_night, null)
    assert.match(block.coverage, /too old/)
  })

  it('flags a provisional night as changeable and builds an HRV range from 14 same-source nights', () => {
    const nights = Array.from({ length: 20 }, (_, i) => night(-i, { overnight_hrv: 40 + (i % 5) }))
    nights[0] = night(0, { status: 'provisional', overnight_hrv: 41 })
    const block = summarizeCoachSleep(nights, TODAY)!
    assert.match(block.coverage, /not final/)
    assert.ok(block.hrv_usual_range_ms && block.hrv_usual_range_ms.nights >= 14)
  })

  it('never mixes devices into the personal HRV range', () => {
    const nights = Array.from({ length: 20 }, (_, i) =>
      night(-i, { device_id: i === 0 ? 'new-watch' : 'old-watch' })
    )
    assert.equal(summarizeCoachSleep(nights, TODAY)!.hrv_usual_range_ms, null)
  })

  it('tells the Coach where sleep evidence lives and not to invent it', () => {
    assert.match(COACH_BODY_PROMPT, /body\.sleep is the only sleep/)
    assert.match(COACH_BODY_PROMPT, /do not infer sleep, HRV, stress/)
  })
})
