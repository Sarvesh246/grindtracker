import type { SupabaseClient } from '@supabase/supabase-js'
import { bodyExtras, computeCharge, type Charge } from './charge'
import type { ReadinessCheck, ReadinessSummary } from './hrv'
import { loadBalance, type LoadBalance } from './load'
import type { StrengthLoad, StrengthSet } from './strength'
import type { DailyBody, LoadSession } from './types'

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
    prefs: DEFAULT_BODY_PREFS,
  }
}

/** Readiness checks; an absent table (migration 68 not applied) reads as none. */
async function readReadiness(supabase: SupabaseClient, userId: string, today: string): Promise<ReadinessCheck[]> {
  const { data, error } = await supabase
    .from('readiness_checks')
    .select('local_date,measured_at,rmssd,ln_rmssd,mean_hr,quality')
    .eq('user_id', userId)
    .gte('local_date', shiftKey(today, -60))
    .lte('local_date', today)
    .order('measured_at')
  return error || !data ? [] : (data as ReadinessCheck[])
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
        .gte('local_date', shiftKey(today, -28))
        .lte('local_date', today),
      supabase.from('body_prefs').select('coach_uses_body,smart_rest').eq('user_id', userId).maybeSingle(),
    ])
    const [readinessChecks, strengthSets] = await Promise.all([
      readReadiness(supabase, userId, today).catch(() => []),
      readStrengthSets(supabase, userId, today).catch(() => []),
    ])
    if (daysRes.error || sessRes.error) return emptyBodySummary(today)
    const days = (daysRes.data ?? []) as DailyBody[]
    const sessions = (sessRes.data ?? []) as LoadSession[]
    const hasWatch = days.length > 0 || sessions.some(s => s.zone_seconds != null) || readinessChecks.length > 0
    const extras = { readiness: readinessChecks, strength: strengthSets }
    const { readiness, strength } = bodyExtras(days, today, extras)
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
      prefs: prefsRes.error ? { ...DEFAULT_BODY_PREFS, coach_uses_body: false } : (prefsRes.data as BodyPrefs | null) ?? DEFAULT_BODY_PREFS,
    }
  } catch {
    return emptyBodySummary(today)
  }
}
