import type { SupabaseClient } from '@supabase/supabase-js'
import { computeCharge, restingBaseline } from '@/lib/body/charge'
import { labelText } from '@/lib/body/signals'
import { fitterLine, type DatedHrSet } from '@/lib/body/cardioCost'
import { heartSentence } from '@/lib/body/workout'
import type { BodySummary } from '@/lib/body/queries'
import type { HrSet } from '@/lib/body/types'
import { LBS_PER_KG } from '@/lib/utils/units'
import { getHealthSummary } from '@/lib/health/queries'
import { sourceLabel } from '@/lib/health/reconcile'
import {
  baseline,
  clockLabel,
  mainSleep,
  shiftDate,
  stageSeconds,
  type HealthHistoryDay,
  type SleepSession
} from '@/lib/health/model'

/**
 * The Coach's `body` block: the watch data, already read for people, in about
 * 400 tokens. Built only for watch users who haven't turned "Coach uses body
 * data" off; everyone else gets no block at all and the Coach behaves exactly
 * as it did before watch data existed.
 *
 * Every read here fails soft. Migration 59 may not be applied yet, and a
 * dropped body read must never fail the whole Coach turn (buildCoachContext
 * throws on its core reads; this is deliberately not one of them).
 */

export interface CoachBodyBlock {
  /**
   * Set only for a sustained resting-HR rise (RISE_BPM+ over the 30-day usual
   * for ALERT_DAYS+ days running). Spelled out as a sentence and placed first:
   * as a bare streak number the model never connected it to the prompt rule
   * (coach:eval E4 failed 0/3).
   */
  alert?: string
  source: string
  /** Today's readiness, with its working shown. */
  charge_today: {
    score: number
    band: string
    inputs: { label: string; value: string }[]
    advice: string
  } | null
  /** Oldest first, today last. */
  last_7_days: { date: string; charge: number | null; resting_hr: number | null }[]
  resting_hr: {
    baseline_30d: number | null
    latest: number | null
    /** Consecutive days, up to the latest reading, at 5+ bpm over baseline. */
    days_in_a_row_5plus_over: number
  }
  load?: { percent: number; band: string; headline: string }
  /** Last night against the user's usual nights: early signs of strain or
   *  illness (src/lib/body/signals.ts). A strain signal, never a diagnosis:
   *  don't tell the user they are sick. */
  body_signals?: {
    level: 'clear' | 'mild' | 'strong'
    headline: string
    off: { signal: string; last_night: string; usual: string }[]
    possible_causes: string[]
    user_noted: string[]
  }
  /** Morning HRV check (watch, 1 min seated): today vs the 60-day usual range. */
  hrv_check?: {
    today_ms: number | null
    usual_range_ms: { low: number; high: number; days: number } | null
    status: 'below' | 'within' | 'above' | null
    /** The 7-day average vs usual, in standard deviations: the trend that matters more than one morning. */
    week_vs_usual_sd: number | null
  }
  /** Lifting load: standard sets this week vs the 28-day weekly average, and the advice it triggers. */
  lifting_load?: {
    standard_sets_7d: number
    weekly_average_28d: number
    percent: number
    band: string
    /** 'deload' = up 30%+ while recovery is falling; 'push' = three steady weeks, no gains, recovered. */
    advice: 'deload' | 'push' | null
    sentence: string
  }
  /** Newest first. */
  watch_sessions?: {
    date: string | null
    day: string
    avg_hr: number | null
    max_hr: number | null
    minutes_z3_plus: number | null
    hardest: string | null
  }[]
  /** Imported sleep and overnight HRV, with when it was measured and how complete the record is. */
  sleep?: CoachSleepBlock
  /** Same weight and reps, peak HR now vs 3+ weeks ago. Positive delta = easier now. */
  cardio_cost?: { exercise: string; at: string; delta_bpm: number; line: string }[]
  /** Every metric against their own 7- and 30-day usual, from the merged history the Health screen shows. */
  trends?: CoachTrendsBlock
}

export type CoachTrendMetric =
  | 'resting_hr'
  | 'overnight_hrv'
  | 'sleep_min'
  | 'sleep_score'
  | 'body_battery'
  | 'stress'
  | 'steps'
  | 'active_min'
  | 'recovery_h'
  | 'spo2'
  | 'vo2max'

export interface CoachMetricTrend {
  latest: number
  latest_date: string
  /** Mean of the 7 days ending at latest_date (the recent week). */
  avg_7d: number | null
  /** Mean of the 30 days before latest_date: their usual. */
  avg_30d: number | null
  /** latest − avg_30d, in the metric's own unit. */
  vs_30d: number | null
  /** How far the recent week sits from the usual, in percent. */
  week_vs_30d_pct: number | null
  days_in_30d: number
  /** Set where a reading depends on the source's method (HRV): the baseline uses only that source. */
  source?: string
}

export interface CoachTrendsBlock {
  span: { first_date: string; last_date: string; days_with_data: number }
  sources: string[]
  metrics: Partial<Record<CoachTrendMetric, CoachMetricTrend>>
  /** Newest first, up to 7 main nights. */
  recent_nights: { date: string; sleep_min: number; score: number | null; hrv_ms: number | null; source: string }[]
}

/** `key` (source+device) set = only compare with points carrying the same key. */
type Point = { date: string; value: number; source?: string; key?: string }

/** Steps and active minutes are running totals: today's partial day is not comparable. */
const PARTIAL_DAY = new Set<CoachTrendMetric>(['steps', 'active_min'])
const ONE_DECIMAL = new Set<CoachTrendMetric>(['spo2', 'vo2max'])

function mean(values: number[]): number | null {
  return values.length ? values.reduce((n, v) => n + v, 0) / values.length : null
}

/** Pure: one metric's latest reading against its own recent week and 30-day usual. */
export function metricTrend(
  points: Point[],
  today: string,
  metric: CoachTrendMetric,
): CoachMetricTrend | null {
  const usable = points
    .filter(p => Number.isFinite(p.value) && p.date <= today && !(PARTIAL_DAY.has(metric) && p.date === today))
    .sort((a, b) => a.date.localeCompare(b.date))
  const last = usable.at(-1)
  if (!last) return null
  // A method-dependent reading (HRV) is only ever compared with its own source.
  const same = last.key ? usable.filter(p => p.key === last.key) : usable
  const ref = last.date
  const week = same.filter(p => p.date > shiftDate(ref, -7) && p.date <= ref).map(p => p.value)
  const prior = same.filter(p => p.date >= shiftDate(ref, -30) && p.date < ref).map(p => p.value)
  const r = (n: number | null) =>
    n == null ? null : ONE_DECIMAL.has(metric) ? Math.round(n * 10) / 10 : Math.round(n)
  const avg7 = mean(week)
  const avg30 = mean(prior)
  return {
    latest: r(last.value)!,
    latest_date: ref,
    avg_7d: r(avg7),
    avg_30d: r(avg30),
    vs_30d: avg30 == null ? null : r(last.value - avg30),
    week_vs_30d_pct: avg7 != null && avg30 ? Math.round(((avg7 - avg30) / avg30) * 100) : null,
    days_in_30d: prior.length,
    ...(last.source ? { source: sourceLabel(last.source) } : {}),
  }
}

/** Main night per wake date, merged across sources exactly as the Health screen shows it. */
function nightsByDate(sleeps: SleepSession[]): SleepSession[] {
  const dates = [...new Set(sleeps.filter(s => s.kind === 'main').map(s => s.wake_date))].sort()
  return dates.map(d => mainSleep(sleeps, d)).filter((s): s is SleepSession => !!s)
}

/**
 * The source+device an HRV number actually came from. A merged night may have
 * borrowed it, and HRV is only comparable within one device's method.
 */
function hrvOrigin(n: SleepSession, sleeps: SleepSession[]): { source: string; key: string } {
  const borrowed = n.fields_from?.overnight_hrv
  if (!borrowed) return { source: n.source, key: `${n.source}:${n.device_id}` }
  const donor = sleeps.find(
    s => s.wake_date === n.wake_date && s.kind === 'main' && s.source === borrowed && s.overnight_hrv === n.overnight_hrv,
  )
  return { source: borrowed, key: `${borrowed}:${donor?.device_id ?? ''}` }
}

/**
 * Pure: baselines and trends across every metric, from the same merged history
 * getHealthSummary() gives the Health screen (watch days, raw samples and every
 * imported night, whichever source sent them).
 */
export function summarizeCoachTrends(input: {
  history: HealthHistoryDay[]
  sleeps: SleepSession[]
  today: string
  sources?: string[]
}): CoachTrendsBlock | null {
  const { history, today } = input
  const nights = nightsByDate(input.sleeps)
  const series = (pick: (d: HealthHistoryDay) => number | null | undefined): Point[] =>
    history.flatMap(d => {
      const v = pick(d)
      return typeof v === 'number' && Number.isFinite(v) ? [{ date: d.local_date, value: v }] : []
    })
  const points: Record<CoachTrendMetric, Point[]> = {
    resting_hr: series(d => d.resting_hr),
    overnight_hrv: nights.flatMap(n =>
      n.overnight_hrv != null ? [{ date: n.wake_date, value: n.overnight_hrv, ...hrvOrigin(n, input.sleeps) }] : [],
    ),
    sleep_min: nights.map(n => ({ date: n.wake_date, value: n.duration_seconds / 60 })),
    sleep_score: nights.flatMap(n => (n.score != null ? [{ date: n.wake_date, value: n.score }] : [])),
    body_battery: series(d => d.bb_latest),
    stress: series(d => d.stress_avg),
    steps: series(d => d.steps),
    active_min: series(d => d.active_minutes),
    recovery_h: series(d => d.recovery_hours),
    spo2: series(d => d.spo2),
    vo2max: series(d => d.vo2max),
  }
  const metrics: CoachTrendsBlock['metrics'] = {}
  for (const key of Object.keys(points) as CoachTrendMetric[]) {
    const t = metricTrend(points[key], today, key)
    if (t) metrics[key] = t
  }
  const dates = [
    ...new Set([...Object.values(points).flatMap(p => p.map(x => x.date))]),
  ].filter(d => d <= today).sort()
  if (!dates.length) return null
  return {
    span: { first_date: dates[0]!, last_date: dates.at(-1)!, days_with_data: dates.length },
    sources: input.sources ?? [],
    metrics,
    recent_nights: nights
      .filter(n => n.wake_date <= today)
      .slice(-7)
      .reverse()
      .map(n => ({
        date: n.wake_date,
        sleep_min: Math.round(n.duration_seconds / 60),
        score: n.score == null ? null : Math.round(n.score),
        hrv_ms: n.overnight_hrv == null ? null : Math.round(n.overnight_hrv),
        source: sourceLabel(n.source),
      })),
  }
}

export interface CoachSleepBlock {
  /** Null when the newest recorded night is older than yesterday. */
  last_night: {
    wake_date: string
    woke_at_local: string
    timezone: string
    duration_min: number
    score: number | null
    stage_minutes: { awake: number | null; rem: number | null; light: number | null; deep: number | null } | null
    overnight_hrv_ms: number | null
    respiration: number | null
    spo2: number | null
    source: string
    status: 'final' | 'provisional' | 'unknown'
  } | null
  nights_recorded_14d: number
  avg_duration_min_14d: number | null
  /** Personal overnight-HRV range from the same source; null until 14 comparable nights exist. */
  hrv_usual_range_ms: { low: number; high: number; nights: number } | null
  coverage: string
}

/** Pure: the sleep evidence the Coach may cite, from rows already read. */
export function summarizeCoachSleep(sleeps: SleepSession[], today: string): CoachSleepBlock | null {
  const mains = sleeps.filter(s => s.kind === 'main')
  if (!mains.length) return null
  const newestDate = mains.map(s => s.wake_date).sort().at(-1)!
  const night = newestDate >= shiftDate(today, -1) ? mainSleep(sleeps, newestDate) : null
  const recent = Array.from({ length: 14 }, (_, i) => mainSleep(sleeps, shiftDate(today, -i))).filter(
    (s): s is SleepSession => !!s,
  )
  const round = (n: number | null | undefined) => (n == null ? null : Math.round(n))
  const mins = (n: number | null) => (n == null ? null : Math.round(n / 60))
  // Compare against the merged nights, by the source the HRV number really came
  // from: a Shortcut night that borrowed its HRV from the Garmin export is
  // compared with the export's history, not with the Shortcut's three nights.
  const hrv = night?.overnight_hrv != null
    ? baseline(
        nightsByDate(sleeps).flatMap(s =>
          s.overnight_hrv != null ? [{ date: s.wake_date, value: s.overnight_hrv, source: hrvOrigin(s, sleeps).key }] : [],
        ),
        night.wake_date,
        hrvOrigin(night, sleeps).key,
      )
    : null
  const stages = night ? stageSeconds(night) : null
  return {
    last_night: night
      ? {
          wake_date: night.wake_date,
          woke_at_local: clockLabel(night.end_at, night.timezone),
          timezone: night.timezone,
          duration_min: Math.round(night.duration_seconds / 60),
          score: round(night.score),
          stage_minutes:
            stages && Object.values(stages).some(v => v != null)
              ? { awake: mins(stages.awake), rem: mins(stages.rem), light: mins(stages.light), deep: mins(stages.deep) }
              : null,
          overnight_hrv_ms: round(night.overnight_hrv),
          respiration: round(night.respiration),
          spo2: round(night.spo2),
          source: night.source,
          status: night.status,
        }
      : null,
    nights_recorded_14d: recent.length,
    avg_duration_min_14d: recent.length
      ? Math.round(recent.reduce((n, s) => n + s.duration_seconds, 0) / recent.length / 60)
      : null,
    hrv_usual_range_ms: hrv ? { low: Math.round(hrv.low), high: Math.round(hrv.high), nights: hrv.count } : null,
    coverage: night
      ? `${recent.length} of the last 14 nights recorded. Sleep stages are wearable estimates${night.status === 'final' ? '' : '; this night is not final and may still change'}.`
      : `Newest recorded night ended ${newestDate}, which is too old to describe how they slept last night. ${recent.length} of the last 14 nights recorded.`,
  }
}

export interface CoachWatchSession {
  local_date: string | null
  day_type: string
  avg_heart_rate: number | null
  max_heart_rate: number | null
  zone_seconds: number[] | null
  sets: HrSet[]
}

/** The caveats themselves live in the prompt's <body_data> rules. */
const SOURCE = 'Garmin watch'

const RISE_BPM = 5
export const ALERT_DAYS = 3
const CARDIO_LOOKBACK_DAYS = 120
const MAX_CARDIO_LINES = 3

function shiftKey(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00`)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** True when this user should get a body block at all. */
export function coachBodyEnabled(summary: BodySummary): boolean {
  return summary.available && summary.hasWatch && summary.prefs.coach_uses_body !== false
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export function bodyWeightFormatter(unit: 'lbs' | 'kg'): (lbs: number) => string {
  return unit === 'kg'
    ? lbs => `${round1(lbs / LBS_PER_KG)} kg`
    : lbs => `${round1(lbs)} lb`
}

/** Consecutive days ending at the latest resting-HR reading that sit 5+ bpm over the 30-day baseline. */
export function restingRiseStreak(summary: BodySummary): number {
  const byDate = new Map(summary.days.map(d => [d.local_date, d]))
  let key = summary.today
  if (byDate.get(key)?.resting_hr == null) key = shiftKey(key, -1)
  let streak = 0
  for (;;) {
    const row = byDate.get(key)
    if (row?.resting_hr == null) break
    const baseline = restingBaseline(summary.days, key)
    if (baseline == null || row.resting_hr - baseline < RISE_BPM) break
    streak += 1
    key = shiftKey(key, -1)
  }
  return streak
}

/** The instruction-shaped sentence the Coach gets for a sustained rise. */
export function restingHrAlert(latest: number, baseline: number, days: number): string {
  const over = Math.round(latest - baseline)
  return (
    `Resting heart rate is ${latest} bpm, ${over} over their usual ${Math.round(baseline)}, ` +
    `and has been 5+ bpm over for ${days} days in a row. Bring this up in your reply whatever they asked: ` +
    `say it probably means they are not fully recovered, suggest an easier day, and once, calmly, ` +
    `suggest checking in with a doctor if it keeps up. Hedge; never name a condition.`
  )
}

/** Pure: everything the Coach sees about the body, from rows already read. */
export function summarizeCoachBody(input: {
  summary: BodySummary
  watchSessions: CoachWatchSession[]
  hrSets: DatedHrSet[]
  unit: 'lbs' | 'kg'
}): CoachBodyBlock {
  const { summary } = input
  const { today, days, sessions } = summary

  const last_7_days = Array.from({ length: 7 }, (_, i) => {
    const date = shiftKey(today, i - 6)
    const row = days.find(d => d.local_date === date)
    const charge = date === today
      ? summary.charge
      : computeCharge(days, sessions, date, { readiness: summary.readinessChecks, strength: summary.strengthSets })
    return { date, charge: charge?.score ?? null, resting_hr: row?.resting_hr ?? null }
  })

  const baseline = restingBaseline(days, today)
  const latestRhr = [...days].reverse().find(d => d.resting_hr != null)?.resting_hr ?? null
  const streak = restingRiseStreak(summary)

  const block: CoachBodyBlock = {
    ...(streak >= ALERT_DAYS && latestRhr != null && baseline != null
      ? { alert: restingHrAlert(latestRhr, baseline, streak) }
      : {}),
    source: SOURCE,
    charge_today: summary.charge
      ? {
          score: summary.charge.score,
          band: summary.charge.bandLabel,
          inputs: summary.charge.inputs.map(i => ({ label: i.label, value: i.value })),
          advice: summary.charge.advice,
        }
      : null,
    last_7_days,
    resting_hr: {
      baseline_30d: baseline != null ? Math.round(baseline) : null,
      latest: latestRhr,
      days_in_a_row_5plus_over: streak,
    },
  }

  if (summary.load) {
    block.load = { percent: summary.load.percent, band: summary.load.band, headline: summary.load.headline }
  }
  const sg = summary.signals
  if (sg && sg.level !== 'learning') {
    block.body_signals = {
      level: sg.level,
      headline: sg.headline,
      off: sg.signals.filter(x => x.off).map(x => ({ signal: x.label, last_night: x.value, usual: x.usual })),
      possible_causes: sg.explanations,
      user_noted: sg.labels.map(labelText),
    }
  }
  const r = summary.readiness
  if (r && (r.today || r.baseline)) {
    block.hrv_check = {
      today_ms: r.today ? Math.round(r.today.rmssd) : null,
      usual_range_ms: r.baseline ? { low: r.baseline.lowMs, high: r.baseline.highMs, days: r.baseline.days } : null,
      status: r.status,
      week_vs_usual_sd: r.weekZ,
    }
  }
  const st = summary.strength
  if (st) {
    block.lifting_load = {
      standard_sets_7d: Math.round(st.acute),
      weekly_average_28d: Math.round(st.chronicWeekly),
      percent: st.percent,
      band: st.band,
      advice: st.advice,
      sentence: st.sentence,
    }
  }

  const watch = input.watchSessions.slice(0, 3).map(s => {
    const z = s.zone_seconds
    return {
      date: s.local_date,
      day: s.day_type,
      avg_hr: s.avg_heart_rate,
      max_hr: s.max_heart_rate,
      minutes_z3_plus: z && z.length >= 5 ? Math.round((z[2] + z[3] + z[4]) / 60) : null,
      hardest: heartSentence(s.sets),
    }
  })
  if (watch.length) block.watch_sessions = watch

  const fmt = bodyWeightFormatter(input.unit)
  const byExercise = new Map<string, DatedHrSet[]>()
  for (const s of input.hrSets) {
    const list = byExercise.get(s.exercise_id) ?? []
    list.push(s)
    byExercise.set(s.exercise_id, list)
  }
  const cardio = [...byExercise.values()]
    .map(sets => ({ name: sets[0]?.exercise_name ?? 'Exercise', line: fitterLine(sets, fmt) }))
    .filter((x): x is { name: string; line: NonNullable<ReturnType<typeof fitterLine>> } => x.line != null)
    .sort((a, b) => Math.abs(b.line.deltaBpm) - Math.abs(a.line.deltaBpm))
    .slice(0, MAX_CARDIO_LINES)
    .map(x => ({ exercise: x.name, at: x.line.label, delta_bpm: x.line.deltaBpm, line: x.line.sentence }))
  if (cardio.length) block.cardio_cost = cardio

  return block
}

type ExerciseJoin = { name: string } | { name: string }[] | null

function joinedName(e: ExerciseJoin): string | undefined {
  if (!e) return undefined
  return Array.isArray(e) ? e[0]?.name : e.name
}

type HrLogRow = {
  session_id?: string
  exercise_id: string
  set_number: number
  weight: number | null
  reps: number | null
  hr_peak: number | null
  hr_end: number | null
  hr_rest_drop_60: number | null
  is_skipped?: boolean | null
  is_warmup?: boolean | null
  exercises: ExerciseJoin
}

function toHrSet(r: HrLogRow): HrSet {
  return {
    exercise_id: r.exercise_id,
    exercise_name: joinedName(r.exercises),
    set_number: r.set_number,
    weight: r.weight,
    reps: r.reps,
    hr_peak: r.hr_peak,
    hr_end: r.hr_end,
    hr_rest_drop_60: r.hr_rest_drop_60,
  }
}

const HR_LOG_COLUMNS =
  'session_id, exercise_id, set_number, weight, reps, hr_peak, hr_end, hr_rest_drop_60, is_skipped, is_warmup, exercises(name)'

async function loadWatchSessions(supabase: SupabaseClient, userId: string): Promise<CoachWatchSession[]> {
  const { data, error } = await supabase
    .from('sessions')
    .select('id, day_type, local_date, avg_heart_rate, max_heart_rate, zone_seconds')
    .eq('user_id', userId)
    .not('completed_at', 'is', null)
    .or('avg_heart_rate.not.is.null,zone_seconds.not.is.null')
    .order('completed_at', { ascending: false })
    .limit(3)
  if (error || !data?.length) return []
  const rows = data as {
    id: string
    day_type: string
    local_date: string | null
    avg_heart_rate: number | null
    max_heart_rate: number | null
    zone_seconds: number[] | null
  }[]
  const { data: logs, error: logErr } = await supabase
    .from('session_logs')
    .select(HR_LOG_COLUMNS)
    .in('session_id', rows.map(r => r.id))
  const bySession = new Map<string, HrSet[]>()
  if (!logErr) {
    for (const l of (logs ?? []) as HrLogRow[]) {
      if (l.is_skipped || !l.session_id) continue
      const list = bySession.get(l.session_id) ?? []
      list.push(toHrSet(l))
      bySession.set(l.session_id, list)
    }
  }
  return rows.map(r => ({
    local_date: r.local_date,
    day_type: r.day_type,
    avg_heart_rate: r.avg_heart_rate,
    max_heart_rate: r.max_heart_rate,
    zone_seconds: r.zone_seconds,
    sets: bySession.get(r.id) ?? [],
  }))
}

async function loadHrSets(supabase: SupabaseClient, userId: string, today: string): Promise<DatedHrSet[]> {
  const { data, error } = await supabase
    .from('session_logs')
    .select(
      'exercise_id, set_number, weight, reps, hr_peak, hr_end, hr_rest_drop_60, is_skipped, is_warmup, exercises(name), sessions!inner(user_id, local_date, completed_at)',
    )
    .eq('sessions.user_id', userId)
    .not('sessions.completed_at', 'is', null)
    .gte('sessions.local_date', shiftKey(today, -CARDIO_LOOKBACK_DAYS))
    .not('hr_peak', 'is', null)
    .limit(3000)
  if (error || !data) return []
  type Row = HrLogRow & {
    sessions: { local_date: string | null } | { local_date: string | null }[] | null
  }
  const out: DatedHrSet[] = []
  for (const r of data as Row[]) {
    if (r.is_skipped || r.is_warmup) continue
    const sess = Array.isArray(r.sessions) ? r.sessions[0] : r.sessions
    if (!sess?.local_date) continue
    out.push({ ...toHrSet(r), local_date: sess.local_date })
  }
  return out
}

/**
 * The block for buildCoachContext, or null (no health data, prefs off,
 * migration not applied, or any read failed outright). Never throws.
 *
 * Reads through getHealthSummary(), the same merged read the Health screen
 * uses, so the Coach sees every source the screen shows (watch days, raw
 * samples, Garmin export and Shortcut nights) over the same 90-day window.
 * It used to read sleep on its own with a 35-day window and only summarise
 * the last 14 nights, so an imported history was invisible to it.
 */
export async function loadCoachBody(
  supabase: SupabaseClient,
  userId: string,
  today: string,
  unit: 'lbs' | 'kg',
  timeZone?: string | null,
): Promise<CoachBodyBlock | null> {
  try {
    const health = await getHealthSummary(supabase, userId, today, timeZone ?? undefined)
    const summary = health.body
    const imported = health.sleeps.length > 0 || health.history.length > 0
    if (!summary.available || summary.prefs.coach_uses_body === false) return null
    if (!summary.hasWatch && !imported) return null
    const [watchSessions, hrSets] = await Promise.all([
      loadWatchSessions(supabase, userId).catch(() => []),
      loadHrSets(supabase, userId, today).catch(() => []),
    ])
    const block = summarizeCoachBody({ summary, watchSessions, hrSets, unit })
    const sources = [
      ...new Set([
        ...(summary.hasWatch ? [SOURCE] : []),
        ...health.connections.filter(c => c.status !== 'revoked').map(c => sourceLabel(c.source)),
        ...health.sleeps.map(s => sourceLabel(s.source)),
      ]),
    ]
    const sleep = health.sleeps.length ? summarizeCoachSleep(health.sleeps, today) : null
    const trends = summarizeCoachTrends({ history: health.history, sleeps: health.sleeps, today, sources })
    return {
      ...block,
      source: sources.join(', ') || SOURCE,
      ...(sleep ? { sleep } : {}),
      ...(trends ? { trends } : {}),
    }
  } catch (err) {
    console.error('[grind] coach body context', err)
    return null
  }
}
