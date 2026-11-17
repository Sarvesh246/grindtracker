import type { SupabaseClient } from '@supabase/supabase-js'
import { computeCharge, restingBaseline } from '@/lib/body/charge'
import { fitterLine, type DatedHrSet } from '@/lib/body/cardioCost'
import { heartSentence } from '@/lib/body/workout'
import { getBodySummary, type BodySummary } from '@/lib/body/queries'
import type { HrSet } from '@/lib/body/types'
import { LBS_PER_KG } from '@/lib/utils/units'
import {
  baseline,
  clockLabel,
  mainSleep,
  shiftDate,
  stageSeconds,
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
  const hrv = night?.overnight_hrv != null
    ? baseline(
        mains.flatMap(s =>
          s.overnight_hrv != null && s.source === night.source && s.device_id === night.device_id
            ? [{ date: s.wake_date, value: s.overnight_hrv, source: 'same' }]
            : [],
        ),
        night.wake_date,
        'same',
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
    const charge = date === today ? summary.charge : computeCharge(days, sessions, date)
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

/** Imported sleep, read soft: migration 61 may not be applied and a failed read just omits the block. */
async function loadCoachSleep(supabase: SupabaseClient, userId: string, today: string): Promise<CoachSleepBlock | null> {
  try {
    const { data, error } = await supabase
      .from('sleep_sessions')
      .select(
        'provider_id,source,device_id,wake_date,provider_date,timezone,start_at,end_at,kind,duration_seconds,score,stages,stage_totals,overnight_hrv,respiration,spo2,revision_at,received_at,status',
      )
      .eq('user_id', userId)
      .gte('wake_date', shiftDate(today, -35))
      .lte('wake_date', today)
      .order('wake_date')
      .limit(120)
    if (error || !data?.length) return null
    return summarizeCoachSleep(data as SleepSession[], today)
  } catch {
    return null
  }
}

/**
 * The block for buildCoachContext, or null (no watch, prefs off, migration not
 * applied, or any read failed outright). Never throws.
 */
export async function loadCoachBody(
  supabase: SupabaseClient,
  userId: string,
  today: string,
  unit: 'lbs' | 'kg',
): Promise<CoachBodyBlock | null> {
  try {
    const summary = await getBodySummary(supabase, userId, today)
    if (!coachBodyEnabled(summary)) return null
    const [watchSessions, hrSets] = await Promise.all([
      loadWatchSessions(supabase, userId).catch(() => []),
      loadHrSets(supabase, userId, today).catch(() => []),
    ])
    const block = summarizeCoachBody({ summary, watchSessions, hrSets, unit })
    const sleep = await loadCoachSleep(supabase, userId, today)
    return sleep ? { ...block, sleep } : block
  } catch (err) {
    console.error('[grind] coach body context', err)
    return null
  }
}
