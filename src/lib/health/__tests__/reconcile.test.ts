import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  compareSamples,
  connectionErrorText,
  localDateIn,
  mergeSamplesIntoHistory,
  relativeTime,
  latestSync,
  type SampleRow
} from '../reconcile'
import { dayAnnotations, intradayEnvelope, mainSleep, type SleepSession } from '../model'

process.env.TZ = 'UTC'

const sample = (over: Partial<SampleRow>): SampleRow => ({
  metric: 'resting_hr',
  provider_id: 'p',
  start_at: '2026-11-16T12:00:00Z',
  end_at: '2026-11-16T12:00:00Z',
  observed_at: '2026-11-16T12:00:00Z',
  revision_at: '2026-11-16T12:05:00Z',
  value: 55,
  unit: 'bpm',
  kind: 'point',
  quality: 'current',
  source: 'connect_iq',
  ...over
})

describe('source precedence', () => {
  it('prefers current over partial, then approved cloud over personal over watch', () => {
    const watch = sample({ source: 'connect_iq' })
    const personal = sample({ source: 'garmin_personal' })
    const business = sample({ source: 'garmin_business' })
    const partialBusiness = sample({ source: 'garmin_business', quality: 'partial' })
    const order = [watch, partialBusiness, personal, business].sort(compareSamples)
    assert.deepEqual(
      order.map((s) => `${s.source}/${s.quality}`),
      [
        'garmin_business/current',
        'garmin_personal/current',
        'connect_iq/current',
        'garmin_business/partial'
      ]
    )
  })

  it('a UTC sample replaces the legacy snapshot and keeps provenance', () => {
    const { history, provenance } = mergeSamplesIntoHistory(
      [{ local_date: '2026-11-16', resting_hr: 60, steps: 4000 }],
      [sample({ value: 52, source: 'garmin_personal' })],
      'UTC'
    )
    assert.equal(history[0].resting_hr, 52)
    assert.equal(history[0].steps, 4000)
    assert.equal(provenance['2026-11-16'].resting_hr?.source, 'garmin_personal')
    assert.equal(provenance['2026-11-16'].steps?.source, 'legacy_snapshot')
  })

  it('never lets unavailable or null readings overwrite a real value', () => {
    const { history } = mergeSamplesIntoHistory(
      [{ local_date: '2026-11-16', resting_hr: 60 }],
      [sample({ value: null }), sample({ quality: 'unavailable', value: 40, provider_id: 'q' })],
      'UTC'
    )
    assert.equal(history[0].resting_hr, 60)
  })

  it('assigns a reading to the viewer’s local day, not the UTC day', () => {
    assert.equal(localDateIn('2026-11-17T03:30:00Z', 'America/Chicago'), '2026-11-16')
    const { history } = mergeSamplesIntoHistory(
      [],
      [sample({ end_at: '2026-11-17T03:30:00Z', value: 49 })],
      'America/Chicago'
    )
    assert.equal(history[0].local_date, '2026-11-16')
  })

  it('does not bridge DST: both sides of a fall-back night land on their own dates', () => {
    // 2026-11-01 is the US fall-back day; 06:30Z is still Oct 31 night-owl time in Chicago.
    assert.equal(localDateIn('2026-11-01T04:30:00Z', 'America/Chicago'), '2026-10-31')
    assert.equal(localDateIn('2026-11-01T07:30:00Z', 'America/Chicago'), '2026-11-01')
  })
})

describe('sleep revisions and sources', () => {
  const base: SleepSession = {
    provider_id: 'a',
    source: 'garmin_personal',
    device_id: 'd',
    wake_date: '2026-11-16',
    provider_date: '2026-11-16',
    timezone: 'UTC',
    start_at: '2026-11-15T23:00:00Z',
    end_at: '2026-11-16T07:00:00Z',
    kind: 'main',
    duration_seconds: 27000,
    score: null,
    stages: null,
    stage_totals: null,
    overnight_hrv: null,
    respiration: null,
    spo2: null,
    revision_at: '2026-11-16T08:00:00Z',
    received_at: '2026-11-16T08:00:00Z',
    status: 'final'
  }
  it('prefers the approved source even when a personal copy was revised later', () => {
    const chosen = mainSleep(
      [
        {
          ...base,
          provider_id: 'b',
          source: 'garmin_business',
          revision_at: '2026-11-16T08:00:00Z'
        },
        {
          ...base,
          provider_id: 'c',
          source: 'garmin_personal',
          revision_at: '2026-11-16T09:00:00Z'
        }
      ],
      '2026-11-16'
    )
    assert.equal(chosen?.provider_id, 'b')
  })
  it('within a source the latest revision wins and naps never become the main sleep', () => {
    const chosen = mainSleep(
      [
        { ...base, provider_id: 'old' },
        { ...base, provider_id: 'new', revision_at: '2026-11-16T10:00:00Z' },
        { ...base, provider_id: 'nap', kind: 'nap', revision_at: '2026-11-16T12:00:00Z' }
      ],
      '2026-11-16'
    )
    assert.equal(chosen?.provider_id, 'new')
  })
  it('draws sleep only up to its wake time, in the sleep’s timezone', () => {
    const [a] = dayAnnotations(
      [],
      { ...base, timezone: 'America/Chicago', end_at: '2026-11-16T13:24:00Z' },
      '2026-11-16'
    )
    assert.equal(a.kind, 'sleep')
    assert.equal(a.from, 0)
    assert.equal(a.to, 29) // 07:24 local
  })
})

describe('workout annotations', () => {
  it('maps a workout onto 15-minute buckets and clips one that crosses midnight', () => {
    const [w] = dayAnnotations(
      [
        {
          day_type: 'legs',
          started_at: '2026-11-16T18:10:00Z',
          completed_at: '2026-11-16T19:05:00Z'
        }
      ],
      null,
      '2026-11-16'
    )
    assert.equal(w.from, 72)
    assert.equal(w.to, 76)
    const [late] = dayAnnotations(
      [
        {
          day_type: 'legs',
          started_at: '2026-11-16T23:30:00Z',
          completed_at: '2026-11-17T00:30:00Z'
        }
      ],
      null,
      '2026-11-16'
    )
    assert.equal(late.to, 95)
  })
  it('ignores impossible or unfinished workouts', () => {
    assert.equal(
      dayAnnotations(
        [
          { day_type: 'x', started_at: null, completed_at: null },
          {
            day_type: 'y',
            started_at: '2026-11-16T10:00:00Z',
            completed_at: '2026-11-16T09:00:00Z'
          }
        ],
        null,
        '2026-11-16'
      ).length,
      0
    )
  })
})

describe('status wording', () => {
  it('describes freshness plainly', () => {
    const now = Date.parse('2026-11-16T12:00:00Z')
    assert.equal(relativeTime('2026-11-16T11:59:00Z', now), 'just now')
    assert.equal(relativeTime('2026-11-16T09:00:00Z', now), '3 h ago')
    assert.equal(relativeTime(null, now), null)
  })
  it('maps provider errors to actionable text without leaking codes', () => {
    assert.match(connectionErrorText('expired_credentials')!, /Reconnect/)
    assert.doesNotMatch(connectionErrorText('weird_internal_42')!, /weird_internal/)
    assert.equal(connectionErrorText(null), null)
  })
})

describe('workout time honesty', () => {
  it('labels a normal workout with its real start, end and length', () => {
    const [w] = dayAnnotations(
      [
        {
          day_type: 'Legs',
          started_at: '2026-11-16T18:10:00Z',
          completed_at: '2026-11-16T19:05:00Z'
        }
      ],
      null,
      '2026-11-16'
    )
    assert.equal(w.label, 'Workout · 6:10 PM – 7:05 PM · 55 min')
  })
  it('does not invent a time for past-dated logs stamped 13:00 UTC', () => {
    assert.equal(
      dayAnnotations(
        [
          {
            day_type: 'Legs',
            started_at: '2026-11-16T12:00:00Z',
            completed_at: '2026-11-16T13:00:00+00:00'
          }
        ],
        null,
        '2026-11-16'
      ).length,
      0
    )
  })
  it('shows only the start of a workout that was left open for hours', () => {
    const [w] = dayAnnotations(
      [
        {
          day_type: 'Legs',
          started_at: '2026-11-16T10:00:00Z',
          completed_at: '2026-11-16T20:30:00Z'
        }
      ],
      null,
      '2026-11-16'
    )
    assert.equal(w.from, w.to)
    assert.match(w.label, /started 10:00 AM/)
  })
})

describe('usual shape of the day', () => {
  const series = (base: number) => Array.from({ length: 96 }, (_, i) => base + (i % 4))
  const days = Array.from({ length: 8 }, (_, i) => ({
    local_date: `2026-11-${String(8 + i).padStart(2, '0')}`,
    bb_series: series(40 + i),
    stress_series: null
  }))
  it('is the 25th–75th percentile of previous days and ignores the selected day', () => {
    const env = intradayEnvelope(days, '2026-11-16', 'bb_series')!
    assert.equal(env.days, 8)
    assert.ok((env.low[10] ?? 0) < (env.high[10] ?? 0))
    assert.ok((env.low[0] ?? 0) >= 40 && (env.high[0] ?? 0) <= 52)
    const withToday = [
      ...days,
      { local_date: '2026-11-16', bb_series: series(99), stress_series: null }
    ]
    assert.deepEqual(intradayEnvelope(withToday, '2026-11-16', 'bb_series'), env)
  })
  it('refuses to claim a norm from fewer than five days', () => {
    assert.equal(intradayEnvelope(days.slice(0, 4), '2026-11-16', 'bb_series'), null)
    assert.equal(intradayEnvelope(days, '2026-11-16', 'stress_series'), null)
  })
  it('leaves buckets blank when too few days have a reading there', () => {
    const sparse = days.map((d, i) => ({
      ...d,
      bb_series: d.bb_series.map((v, b) => (b === 20 && i > 1 ? null : v))
    }))
    const env = intradayEnvelope(sparse, '2026-11-16', 'bb_series')!
    assert.equal(env.low[20], null)
    assert.notEqual(env.low[21], null)
  })
})

describe('latestSync', () => {
  it('picks the newest of connection imports and watch uploads', () => {
    assert.equal(
      latestSync(
        [{ last_success_at: '2026-11-16T09:00:00Z' }, { last_success_at: null }],
        [{ synced_at: '2026-11-16T11:59:00Z' }, { synced_at: '2026-11-15T20:00:00Z' }]
      ),
      '2026-11-16T11:59:00Z'
    )
    assert.equal(
      latestSync([{ last_success_at: '2026-11-16T12:00:00Z' }], [{ synced_at: '2026-11-16T11:00:00Z' }]),
      '2026-11-16T12:00:00Z'
    )
    assert.equal(latestSync([], []), null)
  })
})
