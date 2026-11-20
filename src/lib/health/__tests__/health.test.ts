import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  baseline,
  dailyBrief,
  isHealthMetric,
  mainSleep,
  metricValue,
  shiftDate,
  sleepConsistency,
  validDate,
  type SleepSession
} from '../model'
import { sleepSchema, validateHealthBatch } from '../ingestion'
import { getBodySummary } from '@/lib/body/queries'

const sleep: SleepSession = {
  provider_id: 'night',
  source: 'garmin_personal',
  device_id: 'test-device',
  wake_date: '2026-11-16',
  provider_date: '2026-11-16',
  timezone: 'America/Chicago',
  start_at: '2026-11-16T05:00:00Z',
  end_at: '2026-11-16T13:00:00Z',
  kind: 'main',
  duration_seconds: 27000,
  score: null,
  stages: null,
  stage_totals: null,
  overnight_hrv: null,
  respiration: null,
  spo2: null,
  revision_at: '2026-11-16T14:00:00Z',
  received_at: '2026-11-16T14:00:00Z',
  status: 'unknown'
}
function input(s = sleep) {
  const { source: _source, device_id: _device, received_at: _received, ...record } = s
  return record
}
const batch = {
  version: 1,
  batch_id: 'e7a07f39-26b4-4be6-a2d1-91cd673d9d80',
  generation: 0,
  source: 'connect_iq',
  captured_at: '2026-11-16T15:00:00Z',
  samples: [
    {
      provider_id: 'zero',
      metric: 'steps',
      start_at: '2026-11-16T14:00:00Z',
      end_at: '2026-11-16T14:00:00Z',
      observed_at: '2026-11-16T14:00:00Z',
      revision_at: '2026-11-16T14:00:00Z',
      value: 0,
      unit: 'steps',
      kind: 'total',
      quality: 'partial'
    }
  ],
  sleeps: []
}
const now = new Date('2026-11-16T16:00:00Z')

describe('health evidence and contracts', () => {
  it('fails closed for Coach consent when the preference read fails', async () => {
    const client = {
      from: (table: string) => {
        const result =
          table === 'body_prefs'
            ? { data: null, error: { message: 'offline' } }
            : {
                data: table === 'daily_body' ? [{ local_date: '2026-11-16', resting_hr: 58 }] : [],
                error: null
              }
        const promise = Promise.resolve(result)
        const builder: object = new Proxy(
          {},
          { get: (_target, key) => (key === 'then' ? promise.then.bind(promise) : () => builder) }
        )
        return builder
      }
    }
    const summary = await getBodySummary(client as never, 'owner', '2026-11-16')
    assert.equal(summary.available, true)
    assert.equal(summary.prefs.coach_uses_body, false)
  })
  it('validates actual dates and a metric allowlist', () => {
    assert.equal(validDate('2026-02-30'), false)
    assert.equal(validDate('2024-02-29'), true)
    assert.equal(validDate('2026-01-01<script>'), false)
    assert.equal(isHealthMetric('__proto__'), false)
    assert.equal(isHealthMetric('resting_hr'), true)
  })
  it('shifts calendar dates across both DST transitions without UTC-day drift', () => {
    assert.equal(shiftDate('2026-03-08', 1), '2026-03-09')
    assert.equal(shiftDate('2026-11-01', -1), '2026-10-31')
  })
  it('requires 14 distinct days from the same source for robust comparisons', () => {
    const rows = Array.from({ length: 14 }, (_, i) => ({
      date: shiftDate('2026-11-16', -i - 1),
      value: i === 0 ? 200 : 58,
      source: 'a'
    }))
    assert.equal(baseline(rows.slice(1), '2026-11-16', 'a'), null)
    assert.equal(baseline(rows, '2026-11-16', 'b'), null)
    assert.equal(baseline(rows, '2026-11-16', 'a')?.median, 58)
    assert.equal(baseline([...rows.slice(1), rows[1]], '2026-11-16', 'a'), null)
  })
  it('uses revised main sleep without adding naps or overlapping nights', () => {
    const revised = { ...sleep, duration_seconds: 28000, revision_at: '2026-11-16T15:00:00Z' }
    const nap = {
      ...sleep,
      provider_id: 'nap',
      kind: 'nap' as const,
      revision_at: '2026-11-16T16:00:00Z'
    }
    assert.equal(mainSleep([sleep, revised, nap], '2026-11-16')?.duration_seconds, 28000)
    assert.equal(mainSleep([nap], '2026-11-16'), null)
  })
  it('validates 23/25-hour-day sleep and source timezone rather than server day', () => {
    assert.equal(sleepSchema.safeParse(input()).success, true)
    for (const date of ['2026-03-08', '2026-11-01']) {
      assert.equal(
        sleepSchema.safeParse(
          input({
            ...sleep,
            wake_date: date,
            provider_date: date,
            start_at: `${date}T04:00:00Z`,
            end_at: `${date}T13:00:00Z`
          })
        ).success,
        true
      )
    }
    assert.equal(sleepSchema.safeParse(input({ ...sleep, wake_date: '2026-11-15' })).success, false)
    assert.equal(sleepSchema.safeParse(input({ ...sleep, timezone: 'not/a-zone' })).success, false)
  })
  it('rejects fabricated intervals, overlaps and inflated sleep totals', () => {
    assert.equal(sleepSchema.safeParse(input({ ...sleep, duration_seconds: 40000 })).success, false)
    assert.equal(
      sleepSchema.safeParse(
        input({
          ...sleep,
          stages: [
            { stage: 'deep', start: sleep.start_at, end: sleep.end_at },
            { stage: 'light', start: sleep.start_at, end: sleep.end_at }
          ]
        })
      ).success,
      false
    )
  })
  it('compares bedtimes across midnight without a 24-hour jump', () => {
    const nights = Array.from({ length: 4 }, (_, i) => {
      const wake = shiftDate('2026-11-16', -i)
      return {
        ...sleep,
        timezone: 'UTC',
        wake_date: wake,
        start_at: i % 2 ? `${wake}T00:10:00Z` : `${shiftDate(wake, -1)}T23:50:00Z`,
        end_at: `${wake}T08:00:00Z`
      }
    })
    assert.match(sleepConsistency(nights, '2026-11-16'), /bedtimes spanned 20 minutes/)
  })
  it('preserves legitimate zero, refuses wrong units, future and oversized inputs', () => {
    assert.equal(validateHealthBatch(batch, now).success, true)
    assert.equal(
      validateHealthBatch({ ...batch, samples: [{ ...batch.samples[0], unit: 'bpm' }] }, now)
        .success,
      false
    )
    assert.equal(
      validateHealthBatch({ ...batch, captured_at: '2026-11-17T15:00:00Z' }, now).success,
      false
    )
    assert.equal(
      validateHealthBatch({ ...batch, samples: Array(257).fill(batch.samples[0]) }, now)
        .success,
      false
    )
    assert.equal(
      validateHealthBatch({ ...batch, user_id: 'someone-else' }, now).success,
      false
    )
  })
  it('does not invent a readiness score or count missing sleep as zero', () => {
    const brief = dailyBrief(null, null, [])
    assert.match(brief.headline, /starts here/)
    assert.doesNotMatch(brief.text, /0h|recovered|ready to train/)
    assert.equal(metricValue({ steps: 0 } as never, 'steps'), 0)
    assert.equal(metricValue(null, 'steps'), null)
  })
})
