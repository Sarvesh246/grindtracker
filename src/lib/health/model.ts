import type { DailyBody } from '@/lib/body/types'

export const METRICS = {
  resting_hr: {
    short: 'Resting HR',
    label: 'Resting heart rate',
    unit: 'bpm',
    meaning:
      'Your heart rate at rest. Compare readings from the same device and measurement period.'
  },
  overnight_hrv: {
    short: 'HRV',
    label: 'Overnight heart-rate variability',
    unit: 'ms',
    meaning:
      'Variation in the time between heartbeats during sleep, as supplied by the source. Compare nights from the same device and method; it is not a diagnosis.'
  },
  steps: {
    short: 'Steps',
    label: 'Daily movement',
    unit: 'steps',
    meaning:
      'Steps recorded so far on each date. Partial days are not comparable with completed daily totals.'
  },
  recovery_hours: {
    short: 'Recovery',
    label: 'Recovery time',
    unit: 'h',
    meaning:
      'Garmin’s estimated recovery time remaining at the snapshot. It does not measure muscular recovery.'
  },
  bb_latest: {
    short: 'Body Battery',
    label: 'Body Battery',
    unit: '/ 100',
    meaning: 'Garmin’s energy estimate at the latest recorded snapshot, distinct from GRIND Charge.'
  },
  stress_avg: {
    short: 'Stress',
    label: 'Physiological stress',
    unit: '/ 100',
    meaning: 'Garmin’s average physiological stress estimate. It is not a measure of anxiety.'
  },
  active_minutes: {
    short: 'Active min',
    label: 'Active minutes',
    unit: 'min',
    meaning: 'Activity minutes supplied by the watch for this date.'
  },
  floors: {
    short: 'Floors',
    label: 'Floors climbed',
    unit: 'floors',
    meaning: 'Floors recorded by your watch for this date.'
  },
  spo2: {
    short: 'SpO₂',
    label: 'Oxygen saturation',
    unit: '%',
    meaning:
      'A watch snapshot estimate. This is not an overnight average or a clinical measurement.'
  },
  vo2max: {
    short: 'VO₂ max',
    label: 'VO₂ max estimate',
    unit: 'ml/kg/min',
    meaning: 'Garmin’s estimate of aerobic fitness, when supported by your device.'
  }
} as const
export type HealthMetric = keyof typeof METRICS
export type HealthHistoryDay = Partial<DailyBody> & {
  local_date: string
  overnight_hrv?: number | null
}
export function isHealthMetric(value: string): value is HealthMetric {
  return Object.hasOwn(METRICS, value)
}

export type SleepStageName = 'awake' | 'rem' | 'light' | 'deep'
export interface SleepStage {
  stage: SleepStageName
  start: string
  end: string
}
export interface SleepSession {
  provider_id: string
  source: string
  device_id: string
  wake_date: string
  provider_date: string
  timezone: string
  start_at: string
  end_at: string
  kind: 'main' | 'nap'
  duration_seconds: number
  score: number | null
  stages: SleepStage[] | null
  stage_totals: Partial<Record<SleepStageName, number>> | null
  overnight_hrv: number | null
  respiration: number | null
  spo2: number | null
  revision_at: string
  received_at: string
  status: 'final' | 'provisional' | 'unknown'
}
export type SleepReadState = 'ready' | 'not_enabled' | 'error'

export function validDate(value: string | null | undefined): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
export function shiftDate(date: string, amount: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + amount)
  return d.toISOString().slice(0, 10)
}
export function duration(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
/** "42m" under an hour, "7h 18m" otherwise: short readings read faster. */
export function durationShort(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  return minutes < 60 ? `${minutes}m` : duration(seconds)
}
export function dateLabel(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  })
}
export function clockLabel(iso: string, timezone?: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    ...(timezone ? { timeZone: timezone } : {})
  })
}
export function metricValue(
  row: (Partial<DailyBody> & { overnight_hrv?: number | null }) | null,
  metric: HealthMetric
): number | null {
  const value = row?.[metric]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
/** Approved cloud > personal cloud > watch; unknown source names rank lowest. */
function sourceRank(source: string): number {
  return source === 'garmin_business'
    ? 3
    : source === 'garmin_personal'
      ? 2
      : source === 'connect_iq'
        ? 1
        : 0
}
export function mainSleep(sessions: SleepSession[], date: string): SleepSession | null {
  // Provider revisions replace identities on ingestion; choose one main sleep,
  // never sum overlapping nights or silently fold naps into the main duration.
  return (
    sessions
      .filter((s) => s.wake_date === date && s.kind === 'main')
      .sort(
        (a, b) =>
          sourceRank(b.source) - sourceRank(a.source) ||
          Date.parse(b.revision_at) - Date.parse(a.revision_at)
      )[0] ?? null
  )
}
export interface Baseline {
  median: number
  low: number
  high: number
  count: number
}
export function baseline(
  values: { date: string; value: number; source: string }[],
  date: string,
  source: string
): Baseline | null {
  const byDate = new Map<string, number>()
  for (const v of values)
    if (
      v.date >= shiftDate(date, -28) &&
      v.date < date &&
      v.source === source &&
      Number.isFinite(v.value)
    )
      byDate.set(v.date, v.value)
  const sorted = [...byDate.values()].sort((a, b) => a - b)
  if (sorted.length < 14) return null
  const middle = (sorted.length - 1) / 2
  return {
    median: (sorted[Math.floor(middle)] + sorted[Math.ceil(middle)]) / 2,
    low: sorted[Math.floor((sorted.length - 1) * 0.1)],
    high: sorted[Math.ceil((sorted.length - 1) * 0.9)],
    count: sorted.length
  }
}
export function sleepComparison(sleep: SleepSession, sessions: SleepSession[]): string {
  const recent = new Map<string, SleepSession>()
  for (const s of sessions) {
    if (
      s.kind !== 'main' ||
      s.source !== sleep.source ||
      s.device_id !== sleep.device_id ||
      s.wake_date >= sleep.wake_date ||
      s.wake_date < shiftDate(sleep.wake_date, -28)
    )
      continue
    const old = recent.get(s.wake_date)
    if (!old || s.revision_at > old.revision_at) recent.set(s.wake_date, s)
  }
  if (recent.size < 14)
    return recent.size === 0
      ? 'No earlier nights recorded yet. Comparisons appear as your history builds.'
      : `${recent.size} earlier recorded night${recent.size === 1 ? '' : 's'}; more history will make comparisons useful.`
  const average = [...recent.values()].reduce((n, s) => n + s.duration_seconds, 0) / recent.size
  const delta = Math.round((sleep.duration_seconds - average) / 60)
  return delta === 0
    ? `Matches your average across ${recent.size} recent nights.`
    : `${Math.abs(delta)} minutes ${delta > 0 ? 'longer' : 'shorter'} than your average across ${recent.size} recent nights.`
}
export function dailyBrief(
  row: DailyBody | null,
  sleep: SleepSession | null,
  sessions: SleepSession[]
) {
  if (sleep)
    return {
      headline: 'Your night, in perspective',
      text: `${duration(sleep.duration_seconds)} of sleep recorded. ${sleepComparison(sleep, sessions)}`
    }
  if (row?.bb_latest != null)
    return {
      headline: 'A snapshot of your day',
      text: `Body Battery was ${row.bb_latest} at the recorded snapshot. Sleep and more history will help build a fuller picture.`
    }
  if (row?.resting_hr != null)
    return {
      headline: 'Start with what’s measured',
      text: `Your resting heart rate was ${row.resting_hr} bpm on this date. There isn’t enough evidence for an overall recovery verdict.`
    }
  return {
    headline: 'Your picture starts here',
    text: 'Bring sleep, recovery and daily movement together, with the source and timing behind each reading.'
  }
}

export function sleepConsistency(sessions: SleepSession[], date: string): string {
  const latest = mainSleep(sessions, date)
  if (!latest) return 'No main sleep record for this date.'
  const nights = Array.from({ length: 7 }, (_, i) =>
    mainSleep(sessions, shiftDate(date, -i))
  ).filter(
    (s): s is SleepSession =>
      !!s &&
      s.source === latest.source &&
      s.device_id === latest.device_id &&
      s.timezone === latest.timezone
  )
  if (nights.length < 4)
    return `${nights.length} recorded night${nights.length === 1 ? '' : 's'} in this 7-day window. More comparable nights are needed to describe timing consistency.`
  const clock = (iso: string) => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: latest.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(new Date(iso))
    return (
      Number(parts.find((p) => p.type === 'hour')?.value) * 60 +
      Number(parts.find((p) => p.type === 'minute')?.value)
    )
  }
  const span = (field: 'start_at' | 'end_at') => {
    const anchor = clock(latest[field])
    const offsets = nights.map((n) => ((clock(n[field]) - anchor + 2160) % 1440) - 720)
    return Math.max(...offsets) - Math.min(...offsets)
  }
  return `Across ${nights.length} recorded nights in this 7-day window, bedtimes spanned ${span('start_at')} minutes and wake times spanned ${span('end_at')} minutes. Compared in ${latest.timezone} local time.`
}

export const STAGE_ORDER: SleepStageName[] = ['awake', 'rem', 'light', 'deep']
export const STAGE_NAMES: Record<SleepStageName, string> = {
  awake: 'Awake',
  rem: 'REM',
  light: 'Light',
  deep: 'Deep'
}

/** Seconds per stage: supplied totals first, else summed from intervals, else null. */
export function stageSeconds(sleep: SleepSession): Record<SleepStageName, number | null> {
  const out = {} as Record<SleepStageName, number | null>
  for (const stage of STAGE_ORDER) {
    const recorded = sleep.stages?.filter((s) => s.stage === stage)
    out[stage] =
      sleep.stage_totals?.[stage] ??
      (recorded?.length
        ? recorded.reduce((n, s) => n + (Date.parse(s.end) - Date.parse(s.start)) / 1000, 0)
        : null)
  }
  return out
}

export function seriesStats(values: (number | null)[]) {
  const present = values.filter((v): v is number => v != null && Number.isFinite(v))
  if (!present.length) return null
  return {
    min: Math.min(...present),
    max: Math.max(...present),
    avg: present.reduce((n, v) => n + v, 0) / present.length,
    count: present.length
  }
}

const sleepSourceKey = (s: SleepSession) => `${s.source}:${s.device_id}`
/** The personal range used everywhere a metric is compared with "usual". */
export function metricBaseline(
  history: HealthHistoryDay[],
  sleeps: SleepSession[],
  metric: HealthMetric,
  date: string
): Baseline | null {
  if (metric === 'overnight_hrv') {
    const selected = mainSleep(sleeps, date)
    if (!selected) return null
    return baseline(
      sleeps.flatMap((s) =>
        s.kind === 'main' && s.overnight_hrv != null
          ? [
              {
                date: s.wake_date,
                value: s.overnight_hrv,
                source: sleepSourceKey(s)
              }
            ]
          : []
      ),
      date,
      sleepSourceKey(selected)
    )
  }
  return baseline(
    history.flatMap((row) => {
      const value = metricValue(row, metric)
      return value == null ? [] : [{ date: row.local_date, value, source: 'legacy-watch' }]
    }),
    date,
    'legacy-watch'
  )
}

export interface DayAnnotation {
  kind: 'workout' | 'sleep'
  /** 15-minute bucket indices from local midnight, inclusive. */
  from: number
  to: number
  label: string
}
function minuteOfDay(iso: string, timeZone?: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...(timeZone ? { timeZone } : {})
  }).formatToParts(new Date(iso))
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  return n('hour') * 60 + n('minute')
}
/**
 * Workouts and the night's sleep as intervals on the day's 96-bucket timeline.
 * A workout that crosses midnight is clipped to the selected day; sleep is only
 * drawn up to the morning it ended on, in the sleep's own timezone.
 */
export function dayAnnotations(
  workouts: { day_type: string; started_at: string | null; completed_at: string | null }[],
  sleep: SleepSession | null,
  date: string
): DayAnnotation[] {
  const out: DayAnnotation[] = []
  if (sleep && sleep.wake_date === date)
    out.push({
      kind: 'sleep',
      from: 0,
      to: Math.min(95, Math.floor(minuteOfDay(sleep.end_at, sleep.timezone) / 15)),
      label: `Sleep until ${clockLabel(sleep.end_at, sleep.timezone)}`
    })
  for (const w of workouts) {
    if (!w.started_at || !w.completed_at) continue
    const start = Date.parse(w.started_at)
    let end = Date.parse(w.completed_at)
    if (!(end > start)) continue
    // Past-dated logs are stamped 13:00:00 UTC by the server, not a real time of day.
    if (/T13:00:00(\.0+)?(Z|\+00:00)$/.test(w.completed_at)) continue
    // A workout left open and finished much later has no trustworthy end: show
    // only its start rather than a multi-hour block that never happened.
    const open = end - start > 3 * 3600000
    if (open) end = start
    const sameDay = (iso: string) =>
      new Date(iso).toDateString() === new Date(`${date}T12:00:00`).toDateString()
    const startsToday = sameDay(w.started_at)
    if (!startsToday && !(open ? false : sameDay(new Date(end).toISOString()))) continue
    const from = startsToday ? Math.floor(minuteOfDay(w.started_at) / 15) : 0
    const to = open
      ? from
      : sameDay(new Date(end).toISOString())
        ? Math.floor(minuteOfDay(new Date(end).toISOString()) / 15)
        : 95
    out.push({
      kind: 'workout',
      from,
      to: Math.max(from, to),
      label: open
        ? `Workout · started ${clockLabel(w.started_at)}`
        : `Workout · ${clockLabel(w.started_at)} – ${clockLabel(new Date(end).toISOString())} · ${Math.max(1, Math.round((end - start) / 60000))} min`
    })
  }
  return out
}

export interface Envelope {
  low: (number | null)[]
  high: (number | null)[]
  /** Previous days that contributed. */
  days: number
}
/**
 * The person's usual shape of the day: for each 15-minute bucket, the
 * 25th–75th percentile of the previous `lookback` days. Needs `minDays` days
 * with a reading in that bucket, otherwise the bucket stays blank rather than
 * implying a norm from thin evidence.
 */
export function intradayEnvelope(
  days: {
    local_date: string
    bb_series?: (number | null)[] | null
    stress_series?: (number | null)[] | null
  }[],
  date: string,
  field: 'bb_series' | 'stress_series',
  lookback = 14,
  minDays = 5
): Envelope | null {
  const prior = days.filter(
    (d) =>
      d.local_date < date && d.local_date >= shiftDate(date, -lookback) && Array.isArray(d[field])
  )
  if (prior.length < minDays) return null
  const at = (sorted: number[], q: number) => {
    const pos = (sorted.length - 1) * q
    const lo = Math.floor(pos)
    return sorted[lo] + (sorted[Math.ceil(pos)] - sorted[lo]) * (pos - lo)
  }
  const low: (number | null)[] = []
  const high: (number | null)[] = []
  for (let i = 0; i < 96; i++) {
    const values = prior
      .map((d) => d[field]?.[i])
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
      .sort((a, b) => a - b)
    low.push(values.length >= minDays ? at(values, 0.25) : null)
    high.push(values.length >= minDays ? at(values, 0.75) : null)
  }
  return low.some((v) => v != null) ? { low, high, days: prior.length } : null
}
