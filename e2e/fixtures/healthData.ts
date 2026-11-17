import { computeCharge } from '../../src/lib/body/charge'
import { emptyBodySummary } from '../../src/lib/body/queries'
import { shiftDate, type SleepSession, type SleepStageName } from '../../src/lib/health/model'
import type { DailyBody } from '../../src/lib/body/types'
import type { HealthSummary } from '../../src/lib/health/queries'

export const date = '2026-11-16'
export const days: DailyBody[] = Array.from({ length: 90 }, (_, i) => ({
  local_date: shiftDate(date, i - 89),
  resting_hr: 56 + (i % 5),
  recovery_hours: i % 15,
  steps: 7000 + i * 34,
  bb_wake: 82,
  bb_high: 87,
  bb_low: 32,
  bb_latest: 46,
  stress_avg: 26,
  active_minutes: 48,
  floors: 8,
  spo2: null,
  vo2max: 48,
  synced_at: '2026-11-17T01:00:00Z',
  bb_series: Array.from({ length: 96 }, (_, n) =>
    n > 80 || (n > 40 && n < 49) ? null : Math.round(55 + Math.sin(n / 18) * 30)
  ),
  stress_series: Array.from({ length: 96 }, (_, n) =>
    n > 80 || (n > 40 && n < 49) ? null : Math.round(20 + Math.abs(Math.sin(n / 6)) * 35)
  )
}))
export const sleep: SleepSession = {
  provider_id: 'synthetic-night',
  source: 'Synthetic Garmin fixture',
  device_id: 'fixture-fr165m',
  wake_date: date,
  provider_date: date,
  timezone: 'America/Chicago',
  start_at: '2026-11-16T05:24:00Z',
  end_at: '2026-11-16T13:24:00Z',
  duration_seconds: 26280,
  kind: 'main',
  score: 81,
  stages: [],
  stage_totals: null,
  overnight_hrv: 48,
  respiration: 14,
  spo2: null,
  revision_at: '2026-11-16T14:00:00Z',
  received_at: '2026-11-16T14:02:00Z',
  status: 'final'
}
let at = Date.parse(sleep.start_at)
const stages: [SleepStageName, number][] = [
  ['awake', 12],
  ['light', 45],
  ['deep', 55],
  ['light', 50],
  ['rem', 40],
  ['awake', 15],
  ['light', 75],
  ['deep', 30],
  ['rem', 45],
  ['light', 70],
  ['awake', 15],
  ['rem', 28]
]
sleep.stages = stages.map(([stage, minutes]) => {
  const start = new Date(at).toISOString()
  at += minutes * 60000
  return { stage, start, end: new Date(at).toISOString() }
})
const body = {
  ...emptyBodySummary(date),
  available: true,
  hasWatch: true,
  days,
  todayRow: days.at(-1)!,
  charge: computeCharge(days, [], date)
}
export const data: HealthSummary = {
  body,
  sleeps: [sleep],
  sleepState: 'ready',
  history: days as HealthSummary['history'],
  historyError: false,
  connections: [
    {
      id: 'fixture-connection',
      source: 'connect_iq',
      device_id: 'fixture-fr165m',
      status: 'active',
      last_success_at: '2026-11-17T01:00:00Z',
      last_error_code: null
    }
  ],
  provenance: {
    [date]: {
      resting_hr: { source: 'legacy_snapshot', observed_at: null, quality: 'legacy' },
      steps: { source: 'legacy_snapshot', observed_at: null, quality: 'legacy' }
    }
  },
  workouts: [
    { day_type: 'Legs', started_at: '2026-11-16T18:10:00Z', completed_at: '2026-11-16T19:05:00Z' }
  ]
}
