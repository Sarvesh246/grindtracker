import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Buffer } from 'node:buffer'
import { garminApi, GarminApiError } from '../garmin/api'
import { buildGarminBatch } from '../garmin/collect'
import { matchActivities, normalizeActivity, normalizeDaily, normalizeSleep, timedValues } from '../garmin/normalize'
import { garminSignals, type GarminSignalNight } from '@/lib/body/garminSignals'
import { shiftDate } from '../model'

const zone = 'America/Chicago'
const date = '2026-11-18'
const now = new Date('2026-11-19T01:00:00Z')
const start = Date.parse('2026-11-18T04:00:00Z')
const end = Date.parse('2026-11-18T12:00:00Z')
const raw = {
  id: 4123, calendarDate: date, sleepStartTimestampGMT: start, sleepEndTimestampGMT: end,
  sleepStartTimestampLocal: start - 6 * 3600_000, sleepEndTimestampLocal: end - 6 * 3600_000,
  sleepTimeSeconds: 27_000, deepSleepSeconds: 5000, lightSleepSeconds: 17_000,
  remSleepSeconds: 5000, awakeSleepSeconds: 1805, sleepWindowConfirmed: true,
  sleepFromDevice: true, avgHeartRate: 52.5, averageRespirationValue: 13.2, averageSpO2Value: 96.4,
  sleepScores: { overall: { value: 90 } }, sleepNeed: { deviceId: 341, actual: 480 }
}

describe('Garmin Personal data', () => {
  it('preserves official measurements and accepts the small provider rounding gap', () => {
    const normalized = normalizeSleep(raw, { hrvSummary: { calendarDate: date, lastNightAvg: 55 } }, date, zone, now)
    const [night] = normalized.sleeps
    assert.equal(night.status, 'final')
    assert.equal(night.wake_date, date)
    assert.equal(night.start_at, new Date(start).toISOString())
    assert.equal(night.score, 90)
    assert.equal(night.overnight_hrv, 55)
    assert.equal(night.stages, null)
    assert.equal(night.stage_totals?.awake, 1805)
    assert.equal(normalized.sleepData?.sleep_avg_hr, 52.5)
    assert.equal(normalized.sleepData?.sleep_device, '341')
    assert.equal(buildGarminBatch({ days: [], activities: [], sleeps: [night] }, 0, now, zone)?.sleeps.length, 1)
    assert.equal(buildGarminBatch({ days: [], activities: [], sleeps: [{ ...night, stage_totals: { awake: 30_000 } }] },
      0, now, zone), null)
  })

  it('treats mismatched date, missing measurements and zero distinctly', () => {
    assert.deepEqual(normalizeDaily({ calendarDate: date, movement: { steps: { value: 0 } }, stress: { avgLevel: -1 } }, date), { steps: 0 })
    assert.equal(normalizeSleep(raw, null, '2026-11-19', zone, now).sleeps.length, 0)
    const rows = [[start, 0], [start + 1000, null], [start + 2000, 50]]
    assert.deepEqual(timedValues(rows, [{ index: 0, key: 'timestamp' }, { index: 1, key: 'hr' }],
      [/timestamp/, /hr/], 250), [[start, 0], [start + 2000, 50]])
  })

  it('links only a unique strength session meeting both overlap thresholds', () => {
    const activity = (id = 91, typeKey = 'strength_training') => normalizeActivity({
      activityId: id, beginTimestamp: start, duration: 3600, activityType: { typeKey }
    }, zone)!
    const session = { id: 'grind', day_type: 'pull', started_at: new Date(start + 600_000).toISOString(),
      completed_at: new Date(start + 3700_000).toISOString() }
    const lift = activity(), run = activity(92, 'running')
    matchActivities([lift, run], [session], new Map())
    assert.equal(lift.matched_session_id, 'grind')
    assert.equal(run.match_status, 'unmatched')
    const first = activity(), second = activity(93)
    matchActivities([first, second], [session], new Map())
    assert.equal(first.match_status, 'review')
    assert.equal(second.match_status, 'review')
    const short = { ...session, completed_at: new Date(start + 30 * 60_000).toISOString() }
    const partial = activity()
    matchActivities([partial], [short], new Map())
    assert.equal(partial.match_status, 'unmatched')
  })
})

describe('Garmin access', () => {
  const jwt = (i: number) => [
    'header', Buffer.from(JSON.stringify({ exp: Date.now() / 1000 + 3600, i })).toString('base64url'), 'signature'
  ].join('.')

  it('uses Garmin’s raw JWT response, renews once after 401 and keeps the key on the token path', async () => {
    let exchanges = 0, reads = 0
    const api = garminApi('fixture-key', async (input, options) => {
      assert.equal(new URL(input as URL).origin, 'https://personal.connectapi.garmin.com')
      const headers = new Headers(options?.headers)
      assert.equal(options?.redirect, 'error')
      if (options?.method === 'POST') {
        assert.equal(headers.get('Authorization'), 'ApiKey fixture-key')
        assert.equal(headers.get('Accept'), null)
        return new Response(jwt(++exchanges))
      }
      assert.match(headers.get('Authorization') ?? '', /^Bearer header\./)
      return ++reads === 1 ? new Response(null, { status: 401 }) : Response.json({ ok: true })
    })
    assert.deepEqual(await api.get('/fixture'), { ok: true })
    assert.equal(exchanges, 2)
    await assert.rejects(api.get('https://other.invalid'), (err: unknown) =>
      err instanceof GarminApiError && err.code === 'response')
  })

  it('shares concurrent token exchange and surfaces Garmin backoff', async () => {
    let exchanges = 0
    const api = garminApi('fixture-key', async (_input, options) => {
      if (options?.method === 'POST') return new Response(jwt(++exchanges))
      return new Response(null, { status: 429, headers: { 'Retry-After': '120' } })
    })
    const results = await Promise.allSettled([api.get('/one'), api.get('/two')])
    assert.equal(exchanges, 1)
    for (const result of results) {
      assert.equal(result.status, 'rejected')
      if (result.status !== 'rejected') continue
      assert.equal(result.reason.code, 'rate_limit')
      assert.ok(result.reason.retryAt > Date.now() + 100_000)
    }
  })
})

describe('Garmin overnight outliers', () => {
  function night(d: string, overrides: Partial<GarminSignalNight> = {}): GarminSignalNight {
    return {
      local_date: d, sleep_device: 'watch-1', sleep_status: 'final', sleep_end: d + 'T13:00:00Z',
      sleep_avg_hr: 54, overnight_hrv: 55, sleep_avg_respiration: 13, sleep_spo2: 96,
      ...overrides
    }
  }

  function history(days: number) {
    return new Map(Array.from({ length: days }, (_, i) => {
      const d = shiftDate(date, -1 - i)
      return [d, night(d)] as const
    }))
  }

  it('requires two comparable vitals or two consecutive high-HR nights', () => {
    const past = history(18)
    past.set(date, night(date, { sleep_avg_hr: 62 }))
    assert.equal(garminSignals(past, date).level, 'clear')
    past.set(date, night(date, { sleep_avg_hr: 62, overnight_hrv: 40 }))
    assert.equal(garminSignals(past, date).signals.filter(s => s.off).length, 2)
    assert.equal(garminSignals(past, date).level, 'mild')
    past.set(date, night(date, { sleep_avg_hr: 62 }))
    const yesterday = shiftDate(date, -1)
    past.set(yesterday, night(yesterday, { sleep_avg_hr: 62 }))
    assert.equal(garminSignals(past, date).hrTwoNights, true)
  })

  it('suppresses stale, provisional and device-switch alerts without looking ahead', () => {
    const past = history(13)
    past.set(date, night(date, { sleep_avg_hr: 89, overnight_hrv: 20 }))
    const next = shiftDate(date, 1)
    past.set(next, night(next))
    assert.equal(garminSignals(past, date).level, 'learning')
    const ready = history(28)
    ready.set(date, night(date, { sleep_avg_hr: 89, overnight_hrv: 20, sleep_status: 'provisional' }))
    assert.equal(garminSignals(ready, date).level, 'learning')
    ready.set(date, night(date, { sleep_avg_hr: 89, overnight_hrv: 20, sleep_device: 'new-device' }))
    assert.equal(garminSignals(ready, date).level, 'learning')
    ready.set(date, night(date, { sleep_avg_hr: 89, overnight_hrv: 20, sleep_end: '2026-11-10T12:00:00Z' }))
    assert.equal(garminSignals(ready, date).level, 'learning')
  })
})
