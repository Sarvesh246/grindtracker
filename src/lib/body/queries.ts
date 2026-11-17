import type { SupabaseClient } from '@supabase/supabase-js'
import { computeCharge, type Charge } from './charge'
import { loadBalance, type LoadBalance } from './load'
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
    charge: null, load: null, prefs: DEFAULT_BODY_PREFS,
  }
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
    if (daysRes.error || sessRes.error) return emptyBodySummary(today)
    const days = (daysRes.data ?? []) as DailyBody[]
    const sessions = (sessRes.data ?? []) as LoadSession[]
    const hasWatch = days.length > 0 || sessions.some(s => s.zone_seconds != null)
    return {
      available: true,
      hasWatch,
      today,
      days,
      todayRow: days.find(d => d.local_date === today) ?? null,
      sessions,
      charge: computeCharge(days, sessions, today),
      // Load balance only means something for watch users; web-only users
      // would otherwise get a gauge they never asked for.
      load: hasWatch ? loadBalance(sessions, today) : null,
      // A failed consent read must never silently re-enable Coach health access.
      prefs: prefsRes.error ? { ...DEFAULT_BODY_PREFS, coach_uses_body: false } : (prefsRes.data as BodyPrefs | null) ?? DEFAULT_BODY_PREFS,
    }
  } catch {
    return emptyBodySummary(today)
  }
}
