import { computeCharge, type Charge, type ChargeBand, type ChargeInput } from '@/lib/body/charge'
import {
  mainSleep,
  metricBaseline,
  metricValue,
  shiftDate,
  stageSeconds,
  STAGE_ORDER,
  type Baseline,
  type HealthHistoryDay,
  type HealthMetric,
  type SleepSession,
  type SleepStageName
} from '@/lib/health/model'
import { sourceLabel } from '@/lib/health/reconcile'

/**
 * Display model for the Recovery screens. Pure: everything here takes rows the
 * page already loaded, so the overview, sleep and metric views (and the
 * Progress card) can never disagree about a number or a word.
 */

export interface BandMeta {
  label: 'Primed' | 'Steady' | 'Easy'
  /** 0 Easy, 1 Steady, 2 Push. */
  level: 0 | 1 | 2
  headline: string
  call: string
  rpe: string
  /** The strip on Home names the day by its call. */
  day: string
}
export const BAND: Record<ChargeBand, BandMeta> = {
  primed: {
    label: 'Primed',
    level: 2,
    headline: 'Go heavy today.',
    call: 'Heavy compounds are on. Chase the top set and keep 2–3 min rest.',
    rpe: 'RPE 8–9',
    day: 'Push day'
  },
  steady: {
    label: 'Steady',
    level: 1,
    headline: 'Train, but cap it.',
    call: 'Normal working sets. Leave a rep or two in the tank and skip the grinder.',
    rpe: 'RPE 7–8',
    day: 'Steady day'
  },
  easy: {
    label: 'Easy',
    level: 0,
    headline: 'Keep it easy.',
    call: 'Mobility, zone 2 or a light pump. Keep your weights and drop the last set.',
    rpe: 'RPE ≤ 6',
    day: 'Easy day'
  }
}
export const LEVELS = ['Easy', 'Steady', 'Push'] as const

/** The advice sentence without its leading band word, which the chip already shows. */
export function adviceText(charge: Charge): string {
  return charge.advice.replace(/^(Primed|Steady|Easy)\.\s*/, '')
}

export type DriverEffect = 'helped' | 'held' | 'neutral'
export interface Driver {
  key: string
  label: string
  value: string
  /** −1 (held you back) … +1 (helped), from the input's 0–100 score. */
  impact: number
  effect: DriverEffect
  weight: number
  note: string
}
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
/**
 * Charge inputs as push/pull: a score of 50 is neutral, 100 helped fully and
 * 0 held back fully. Ordered by how much each one actually moved the score
 * (distance from neutral × its weight), so the first row is the reason.
 */
export function drivers(inputs: ChargeInput[]): Driver[] {
  return inputs
    .map((input) => {
      const impact = Math.max(-1, Math.min(1, (input.score - 50) / 50))
      return {
        key: input.key,
        label: input.label,
        value: input.value,
        impact,
        effect: (input.score >= 60
          ? 'helped'
          : input.score < 40
            ? 'held'
            : 'neutral') as DriverEffect,
        weight: input.weight,
        note: `${capitalize(input.phrase)}.`
      }
    })
    .sort((a, b) => Math.abs(b.impact) * b.weight - Math.abs(a.impact) * a.weight)
}

/** Window of seven dates for the day strip: ends today while browsing the last week. */
export function weekWindow(date: string, today: string): string[] {
  const end =
    date >= shiftDate(today, -6) ? today : shiftDate(date, 3) > today ? today : shiftDate(date, 3)
  return Array.from({ length: 7 }, (_, i) => shiftDate(end, i - 6))
}

export type Standing = 'in' | 'above' | 'below' | 'total' | 'calibrating' | 'none'
export const VOLUME_METRICS: HealthMetric[] = ['steps', 'active_minutes', 'floors']
export const isVolume = (m: HealthMetric) => VOLUME_METRICS.includes(m)

export function formatMetric(value: number, metric: HealthMetric): string {
  if (metric === 'vo2max') return value.toFixed(1).replace(/\.0$/, '')
  return Math.round(value).toLocaleString('en-US')
}

/** Short unit for tiles: "/ 100" reads as noise next to a big number. */
export function shortUnit(metric: HealthMetric): string {
  return (
    {
      resting_hr: 'bpm',
      overnight_hrv: 'ms',
      steps: '',
      recovery_hours: 'h',
      bb_latest: '',
      stress_avg: '',
      active_minutes: 'min',
      floors: '',
      spo2: '%',
      vo2max: 'ml/kg/min'
    } as Record<HealthMetric, string>
  )[metric]
}

export interface Reading {
  value: number | null
  base: Baseline | null
  standing: Standing
  /** "In your usual range", "+4 bpm above usual", "Daily total · avg 8,900". */
  text: string
  /** Positions on a 0–100 track: the usual band and today's dot. */
  track: { bandLeft: number; bandWidth: number; dot: number } | null
}
/** A value against the person's own usual: never a good/bad verdict. */
export function reading(
  history: HealthHistoryDay[],
  sleeps: SleepSession[],
  metric: HealthMetric,
  date: string
): Reading {
  const row = history.find((d) => d.local_date === date) ?? null
  const value = metricValue(row, metric)
  const unit = shortUnit(metric)
  const recent = history
    .filter((d) => d.local_date <= date && d.local_date > shiftDate(date, -28))
    .map((d) => metricValue(d, metric))
    .filter((v): v is number => v != null)
  if (isVolume(metric)) {
    const prior = recent.slice(0, -1)
    const avg = prior.length ? prior.reduce((a, b) => a + b, 0) / prior.length : null
    const top = Math.max(1, ...recent, avg ?? 0) * 1.1
    return {
      value,
      base: null,
      standing: value == null ? 'none' : 'total',
      text:
        value == null
          ? 'No reading'
          : avg != null
            ? `Daily total · avg ${formatMetric(avg, metric)}`
            : 'Daily total',
      track: value == null ? null : { bandLeft: 0, bandWidth: 0, dot: (value / top) * 100 }
    }
  }
  const base = metricBaseline(history, sleeps, metric, date)
  if (value == null) return { value, base, standing: 'none', text: 'No reading', track: null }
  if (!base)
    return {
      value,
      base,
      standing: 'calibrating',
      text: 'Learning your usual',
      track: null
    }
  const lo = Math.min(base.low, value, ...recent)
  const hi = Math.max(base.high, value, ...recent)
  const pad = (hi - lo) * 0.18 || 1
  const scale = (v: number) => ((v - (lo - pad)) / (hi - lo + 2 * pad)) * 100
  const diff = (n: number) => formatMetric(Math.abs(n), metric) + (unit ? ` ${unit}` : '')
  const standing: Standing = value > base.high ? 'above' : value < base.low ? 'below' : 'in'
  return {
    value,
    base,
    standing,
    text:
      standing === 'above'
        ? `+${diff(value - base.high)} above usual`
        : standing === 'below'
          ? `${diff(base.low - value)} below usual`
          : 'In your usual range',
    track: {
      bandLeft: scale(base.low),
      bandWidth: Math.max(2, scale(base.high) - scale(base.low)),
      dot: Math.max(3, Math.min(97, scale(value)))
    }
  }
}

/** Seconds → "7h 18m"; under an hour "42m". */
export function hm(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  const h = Math.floor(minutes / 60)
  return h ? `${h}h ${minutes % 60}m` : `${minutes % 60}m`
}

/** The usual time in each stage: 25th–75th percentile of the same source's last 28 nights. */
export function stageUsual(
  sleeps: SleepSession[],
  sleep: SleepSession
): Partial<Record<SleepStageName, [number, number]>> {
  const nights = new Map<string, SleepSession>()
  for (let i = 1; i <= 28; i++) {
    const day = shiftDate(sleep.wake_date, -i)
    const night = mainSleep(sleeps, day)
    if (night && night.source === sleep.source) nights.set(day, night)
  }
  const out: Partial<Record<SleepStageName, [number, number]>> = {}
  for (const stage of STAGE_ORDER) {
    const values = [...nights.values()]
      .map((n) => stageSeconds(n)[stage])
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b)
    if (values.length < 5) continue
    const at = (q: number) => values[Math.round((values.length - 1) * q)]
    out[stage] = [at(0.25), at(0.75)]
  }
  return out
}

export const STAGE_LANE: Record<SleepStageName, number> = {
  awake: 0,
  rem: 1,
  light: 2,
  deep: 3
}

/** Clock minutes in the sleep's own timezone, folded so evenings are negative. */
export function clockMinutes(iso: string, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(iso))
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const m = n('hour') * 60 + n('minute')
  return m >= 720 ? m - 1440 : m
}

/**
 * Bed and wake on one continuous timeline: bed is folded like clockMinutes,
 * wake is bed plus the real elapsed time, so a 23:00-12:00 sleep stays
 * -60..720 instead of folding the wake into the previous evening.
 */
export function sleepSpan(night: { start_at: string; end_at: string; timezone: string }): {
  bed: number
  wake: number
} {
  const bed = clockMinutes(night.start_at, night.timezone)
  const elapsed = (new Date(night.end_at).getTime() - new Date(night.start_at).getTime()) / 60000
  return { bed, wake: bed + Math.max(0, Math.round(elapsed)) }
}

const FIELD_NAME = {
  stages: 'stage timeline',
  stage_totals: 'stage totals',
  score: 'sleep score',
  overnight_hrv: 'overnight HRV',
  respiration: 'respiration',
  spo2: 'oxygen'
} as const
/** "Garmin data export · stage timeline from Apple Health": where a night's numbers came from. */
export function sleepSourcesNote(sleep: SleepSession): string {
  const borrowed = Object.entries(sleep.fields_from ?? {}) as [keyof typeof FIELD_NAME, string][]
  if (!borrowed.length) return sourceLabel(sleep.source)
  const bySource = new Map<string, string[]>()
  for (const [field, source] of borrowed)
    bySource.set(source, [...(bySource.get(source) ?? []), FIELD_NAME[field]])
  return `${sourceLabel(sleep.source)} · ${[...bySource]
    .map(([src, fields]) => `${fields.join(' and ')} from ${sourceLabel(src)}`)
    .join(' · ')}`
}

/** 15-minute bucket index → "4:15 PM". */
export function bucketClock(i: number): string {
  const h = Math.floor(i / 4) % 24
  const m = (i % 4) * 15
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

/** Index of the last present value, or −1. */
export function lastIndex(values: (number | null | undefined)[]): number {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] != null) return i
  return -1
}

/** SVG path through present points; a gap lifts the pen instead of drawing a fake line. */
export function linePath(
  values: (number | null | undefined)[],
  x: (i: number) => number,
  y: (v: number) => number
): string {
  let d = ''
  let pen = false
  values.forEach((v, i) => {
    if (v == null || !Number.isFinite(v)) {
      pen = false
      return
    }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`
    pen = true
  })
  return d
}

/**
 * Each morning's Charge for the seven days ending `end`, from one body
 * summary (computed exactly as Home and the watch do). Days after the
 * summary's own date are left out: the page keeps those from earlier loads.
 */
export function weekCharges(
  body: {
    today: string
    days: import('@/lib/body/types').DailyBody[]
    sessions: import('@/lib/body/types').LoadSession[]
    charge: Charge | null
    readinessChecks: import('@/lib/body/hrv').ReadinessCheck[]
    strengthSets: import('@/lib/body/strength').StrengthSet[]
    overnightHrv?: Record<string, number>
  },
  end: string = body.today
): Map<string, Charge | null> {
  const extras = {
    readiness: body.readinessChecks,
    strength: body.strengthSets,
    overnightHrv: new Map(Object.entries(body.overnightHrv ?? {}))
  }
  const out = new Map<string, Charge | null>()
  for (let i = 6; i >= 0; i--) {
    const day = shiftDate(end, -i)
    if (day > body.today) continue
    out.set(
      day,
      day === body.today ? body.charge : computeCharge(body.days, body.sessions, day, extras)
    )
  }
  return out
}

/** Filled area under each run of present points, closed to the baseline: gaps stay empty. */
export function areaPath(
  values: (number | null | undefined)[],
  x: (i: number) => number,
  y: (v: number) => number,
  floor: number
): string {
  let d = ''
  let start = -1
  const close = (end: number) => {
    d += `L${x(end).toFixed(1)} ${floor}L${x(start).toFixed(1)} ${floor}Z`
  }
  values.forEach((v, i) => {
    if (v == null || !Number.isFinite(v)) {
      if (start >= 0) close(i - 1)
      start = -1
      return
    }
    d += `${start < 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`
    if (start < 0) start = i
  })
  if (start >= 0) close(values.length - 1)
  return d
}

/**
 * The hero's one sentence: what helped most and what held Charge back most,
 * in the inputs' own words ("You woke with Body Battery at 88 and nothing's
 * holding you back.").
 */
export function ledeFor(charge: Charge): string {
  const list = [...charge.inputs].sort(
    (a, b) => Math.abs(b.score - 50) * b.weight - Math.abs(a.score - 50) * a.weight
  )
  const helped = list.find((i) => i.score >= 60)
  const held = list.find((i) => i.score < 40)
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  if (helped && held) return `${cap(helped.phrase)}, but ${held.phrase}.`
  if (helped) return `${cap(helped.phrase)} and nothing’s holding you back.`
  if (held) return `${cap(held.phrase)}. Give it a day.`
  return 'Everything is sitting near your usual.'
}
