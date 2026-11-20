import type { SupabaseClient } from '@supabase/supabase-js'
import { bodyExtras, computeCharge, type Charge } from './charge'
import type { ReadinessCheck, ReadinessSummary } from './hrv'
import { loadBalance, type LoadBalance } from './load'
import type { StrengthLoad, StrengthSet } from './strength'
import { hrRange, type HrRange } from './hrRange'
import { computeSignals, signalTrackRecord, type BodySignals, type SignalLabel } from './signals'
import type { BodySync, DailyBody, LoadSession } from './types'

/**
 * The one read every body surface shares. Works with either Supabase client
 * (RLS keeps it to the caller's own rows). A missing table (migration 59 not
 * applied yet) or a failed read returns `available: false`, and every surface
 * then hides itself, so nothing breaks for anyone.
 */

export interface BodyPrefs {
  coach_uses_body: boolean
  smart_rest: boolean
}

export const DEFAULT_BODY_PREFS: BodyPrefs = { coach_uses_body: true, smart_rest: false }

export interface BodySummary {
  available: boolean
  /** True once any watch data exists for this user. */
  hasWatch: boolean
  today: string
  days: DailyBody[]
  todayRow: DailyBody | null
  sessions: LoadSession[]
  charge: Charge | null
  load: LoadBalance | null
  /** Morning HRV checks (migration 68), the last 60 days. */
  readinessChecks: ReadinessCheck[]
  readiness: ReadinessSummary | null
  /** Working sets of the last 90 days, for lifting load. */
  strengthSets: StrengthSet[]
  strength: StrengthLoad | null
  prefs: BodyPrefs
  /** Stored watch snapshots of the last 14 days, newest first (migration 69;
   *  empty before it). */
  syncs: BodySync[]
  /** Today's lowest and highest raw heart-rate sample in each 15-min bucket
   *  (migration 70's body_sync_log samples); null without them. */
  todayHrRange: HrRange | null
  /** Last night against your usual nights (signals.ts). */
  signals: BodySignals | null
  /** Flagged mornings in the last 4 weeks (signals.ts RECORD_DAYS), and how
   *  you labelled them. */
  signalRecord: { flagged: number; labelled: number; sick: number } | null
  /** The readiness read failed. `readinessChecks` is then empty but unknown. */
  readinessError: boolean
  /** The signal-tag read failed. `signals.labels` is then empty but unknown. */
  labelsError: boolean
}

const DAY_COLUMNS =
  'local_date,bb_series,stress_series,bb_high,bb_low,bb_latest,bb_wake,stress_avg,resting_hr,recovery_hours,steps,active_minutes,floors,spo2,vo2max,synced_at'

function shiftKey(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00`)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function emptyBodySummary(today: string): BodySummary {
  return {
    available: false, hasWatch: false, today, days: [], todayRow: null, sessions: [],
    charge: null, load: null, readinessChecks: [], readiness: null, strengthSets: [], strength: null,
    prefs: DEFAULT_BODY_PREFS, syncs: [], todayHrRange: null, signals: null, signalRecord: null,
    readinessError: false, labelsError: false,
  }
}

/** A table a migration hasn't created yet reads as "none"; any other error is a failed read. */
function absentTable(error: { code?: string } | null): boolean {
  return !!error && ['42P01', 'PGRST205'].includes(error.code ?? '')
}

const INTRADAY_COLUMNS = 'local_date,hr_series,steps_series,active_series,floors_series'

/** Migration 69's day curves, merged into the day rows. Read on their own so a
 *  database without the columns yet still shows everything else. */
async function readIntraday(supabase: SupabaseClient, userId: string, today: string): Promise<Map<string, Partial<DailyBody>>> {
  const { data, error } = await supabase
    .from('daily_body')
    .select(INTRADAY_COLUMNS)
    .eq('user_id', userId)
    .gte('local_date', shiftKey(today, -35))
    .lte('local_date', today)
  const out = new Map<string, Partial<DailyBody>>()
  if (error || !data) return out
  for (const r of data as unknown as Partial<DailyBody>[]) if (r.local_date) out.set(r.local_date, r)
  return out
}

type NightSeries = Pick<DailyBody, 'resp_series' | 'temp_series'>

/** Migrations 71 and 72's night curves (respiration, temperature), read on
 *  their own like the intraday columns so a database without them yet still
 *  shows everything else. */
async function readNightSeries(supabase: SupabaseClient, userId: string, today: string): Promise<Map<string, NightSeries>> {
  const read = (cols: string) => supabase
    .from('daily_body')
    .select(cols)
    .eq('user_id', userId)
    .gte('local_date', shiftKey(today, -35))
    .lte('local_date', today)
  let res = await read('local_date,resp_series,temp_series')
  if (res.error) res = await read('local_date,resp_series')
  const out = new Map<string, NightSeries>()
  if (res.error || !res.data) return out
  for (const r of res.data as unknown as (NightSeries & { local_date: string })[]) {
    out.set(r.local_date, { resp_series: r.resp_series ?? null, temp_series: r.temp_series ?? null })
  }
  return out
}

/** What you said flagged mornings were (migration 72); none before it. Null on a failed read. */
async function readSignalLabels(supabase: SupabaseClient, userId: string, today: string): Promise<SignalLabel[] | null> {
  const { data, error } = await supabase
    .from('body_signal_labels')
    .select('local_date,tags')
    .eq('user_id', userId)
    .gte('local_date', shiftKey(today, -120))
    .lte('local_date', today)
  if (error) return absentTable(error) ? [] : null
  return (data ?? []) as SignalLabel[]
}

/** Overnight HRV from an imported sleep source (the Garmin export), by wake
 *  date. The watch can't read HRV overnight itself. */
async function readOvernightHrv(supabase: SupabaseClient, userId: string, today: string): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from('sleep_sessions')
    .select('wake_date,overnight_hrv,kind')
    .eq('user_id', userId)
    .eq('kind', 'main')
    .not('overnight_hrv', 'is', null)
    .gte('wake_date', shiftKey(today, -120))
    .lte('wake_date', today)
  const out = new Map<string, number>()
  if (error || !data) return out
  for (const r of data as { wake_date: string; overnight_hrv: number }[]) out.set(r.wake_date, Number(r.overnight_hrv))
  return out
}

/** Today's raw all-day heart-rate samples (migration 70), as a 15-min range. */
async function readTodayHrRange(supabase: SupabaseClient, userId: string, today: string): Promise<HrRange | null> {
  const { data, error } = await supabase
    .from('body_sync_log')
    .select('hr_t,hr_v')
    .eq('user_id', userId)
    .eq('local_date', today)
    .not('hr_t', 'is', null)
    .order('received_at', { ascending: false })
    .limit(200)
  if (error || !data) return null
  return hrRange(data as { hr_t: number[] | null; hr_v: number[] | null }[])
}

/** Watch snapshots as they arrived; an absent table reads as none. */
async function readSyncs(supabase: SupabaseClient, userId: string): Promise<BodySync[]> {
  const { data, error } = await supabase
    .from('body_sync_log')
    .select('local_date,received_at,source')
    .eq('user_id', userId)
    .order('received_at', { ascending: false })
    .limit(200)
  return error || !data ? [] : (data as BodySync[])
}

/** Readiness checks; an absent table (migration 68 not applied) reads as none. Null on a failed read. */
async function readReadiness(supabase: SupabaseClient, userId: string, today: string): Promise<ReadinessCheck[] | null> {
  const { data, error } = await supabase
    .from('readiness_checks')
    .select('local_date,measured_at,rmssd,ln_rmssd,mean_hr,quality')
    .eq('user_id', userId)
    .gte('local_date', shiftKey(today, -60))
    .lte('local_date', today)
    .order('measured_at')
  if (error) return absentTable(error) ? [] : null
  return (data ?? []) as ReadinessCheck[]
}

/** Working sets for lifting load: completed sessions, no warm-ups or skips. */
export async function readStrengthSets(supabase: SupabaseClient, userId: string, today: string): Promise<StrengthSet[]> {
  const { data, error } = await supabase
    .from('session_logs')
    .select('exercise_id, weight, reps, is_skipped, is_warmup, sessions!inner(user_id, local_date, completed_at)')
    .eq('sessions.user_id', userId)
    .not('sessions.completed_at', 'is', null)
    .gte('sessions.local_date', shiftKey(today, -90))
    .lte('sessions.local_date', today)
    .limit(5000)
  if (error || !data) return []
  type Row = { exercise_id: string; weight: number | null; reps: number | null; is_skipped: boolean | null; is_warmup: boolean | null
    sessions: { local_date: string | null } | { local_date: string | null }[] | null }
  const out: StrengthSet[] = []
  for (const r of data as Row[]) {
    if (r.is_skipped || r.is_warmup || r.reps == null) continue
    const sess = Array.isArray(r.sessions) ? r.sessions[0] : r.sessions
    if (!sess?.local_date) continue
    out.push({ local_date: sess.local_date, exercise_id: r.exercise_id, weight: r.weight == null ? null : Number(r.weight), reps: r.reps })
  }
  return out
}

/** `today` must come from localDateKey() (CLAUDE.md "Dates & timezones"). */
export async function getBodySummary(supabase: SupabaseClient, userId: string, today: string): Promise<BodySummary> {
  try {
    const [daysRes, sessRes, prefsRes] = await Promise.all([
      supabase
        .from('daily_body')
        .select(DAY_COLUMNS)
        .eq('user_id', userId)
        .gte('local_date', shiftKey(today, -35))
        .lte('local_date', today)
        .order('local_date'),
      supabase
        .from('sessions')
        .select('local_date,started_at,completed_at,zone_seconds')
        .eq('user_id', userId)
        .not('completed_at', 'is', null)
        // 28 days of chronic load for each of the last 7 days (the Coach's
        // Charge strip recomputes them), not just for today.
        .gte('local_date', shiftKey(today, -35))
        .lte('local_date', today),
      supabase.from('body_prefs').select('coach_uses_body,smart_rest').eq('user_id', userId).maybeSingle(),
    ])
    const [readinessRead, strengthSets, intraday, syncs, night, todayHrRange, labelsRead, overnightHrv] = await Promise.all([
      readReadiness(supabase, userId, today).catch(() => null),
      readStrengthSets(supabase, userId, today).catch(() => []),
      readIntraday(supabase, userId, today).catch(() => new Map<string, Partial<DailyBody>>()),
      readSyncs(supabase, userId).catch(() => []),
      readNightSeries(supabase, userId, today).catch(() => new Map<string, NightSeries>()),
      readTodayHrRange(supabase, userId, today).catch(() => null),
      readSignalLabels(supabase, userId, today).catch(() => null),
      readOvernightHrv(supabase, userId, today).catch(() => new Map<string, number>()),
    ])
    const readinessChecks = readinessRead ?? []
    const labels = labelsRead ?? []
    if (daysRes.error || sessRes.error) return emptyBodySummary(today)
    const days = ((daysRes.data ?? []) as DailyBody[]).map(d => ({
      ...d,
      ...intraday.get(d.local_date),
      ...night.get(d.local_date),
    }))
    const sessions = (sessRes.data ?? []) as LoadSession[]
    const hasWatch = days.length > 0 || sessions.some(s => s.zone_seconds != null) || readinessChecks.length > 0
    const extras = { readiness: readinessChecks, strength: strengthSets }
    const { readiness, strength } = bodyExtras(days, today, extras)
    const signalExtras = { readiness: readinessChecks, sessions, labels, overnightHrv }
    return {
      available: true,
      hasWatch,
      today,
      days,
      todayRow: days.find(d => d.local_date === today) ?? null,
      sessions,
      charge: computeCharge(days, sessions, today, extras),
      // Load balance only means something for watch users; web-only users
      // would otherwise get a gauge they never asked for.
      load: hasWatch ? loadBalance(sessions, today) : null,
      readinessChecks,
      readiness,
      strengthSets,
      // Lifting load needs no watch: every logged set counts.
      strength,
      // A failed consent read must never silently re-enable Coach health access.
      syncs,
      todayHrRange,
      signals: hasWatch ? computeSignals(days, today, signalExtras) : null,
      signalRecord: hasWatch ? signalTrackRecord(days, today, signalExtras) : null,
      readinessError: readinessRead === null,
      labelsError: labelsRead === null,
      prefs: prefsRes.error ? { ...DEFAULT_BODY_PREFS, coach_uses_body: false } : (prefsRes.data as BodyPrefs | null) ?? DEFAULT_BODY_PREFS,
    }
  } catch {
    return emptyBodySummary(today)
  }
}
