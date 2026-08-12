import type { SupabaseClient } from '@supabase/supabase-js'
import type { UserRotation } from '@/lib/types'
import { effectiveSequence, nextDay } from '@/lib/utils/rotation'
import {
  COACH_CONTEXT_BODY_WEIGHTS,
  COACH_CONTEXT_RECENT_PRS,
  COACH_CONTEXT_SESSIONS,
  COACH_CONTEXT_SETS_PER_SESSION,
} from './constants'

export type CoachUnitPreference = 'lbs' | 'kg'

export interface CoachContext {
  as_of_local_date: string
  /** IANA tz from the client when provided (informational for the model). */
  time_zone: string | null
  unit_preference: CoachUnitPreference
  /** Canonical storage is always lbs; convert for display when unit is kg. */
  weight_storage: 'lbs'
  profile: {
    display_name: string | null
    username: string | null
  }
  stats: {
    xp_total: number
    level: number
    current_streak: number
    longest_streak: number
    last_workout_date: string | null
    total_workouts: number
  } | null
  program: {
    days: string[]
    rotation_mode: 'auto' | 'manual' | null
    sequence: string[]
    current_index: number | null
    next_day: string | null
  }
  rest: {
    weekly_days_of_week: number[]
    recent_one_off_dates: string[]
  }
  body_weight: {
    recent: { date: string; weight_lbs: number }[]
  }
  recent_sessions: {
    local_date: string | null
    day_type: string
    completed_at: string | null
    xp_earned: number
    note: string | null
    sets: {
      exercise: string
      set_number: number
      weight_lbs: number | null
      reps: number | null
      is_pr: boolean
      is_warmup: boolean
      rpe: number | null
    }[]
  }[]
  recent_prs: {
    exercise: string
    weight_lbs: number
    reps: number
    local_date: string | null
    completed_at: string | null
  }[]
}

type SessionRow = {
  id: string
  day_type: string
  completed_at: string | null
  local_date: string | null
  xp_earned: number
  note: string | null
}

type LogRow = {
  session_id: string
  set_number: number
  weight: number | null
  reps: number | null
  is_pr: boolean
  is_warmup: boolean | null
  is_skipped: boolean | null
  rpe: number | null
  created_at: string
  exercises: { name: string } | { name: string }[] | null
}

function exerciseName(exercises: LogRow['exercises']): string {
  if (!exercises) return 'Unknown'
  if (Array.isArray(exercises)) return exercises[0]?.name ?? 'Unknown'
  return exercises.name ?? 'Unknown'
}

/**
 * Build a compact personal snapshot for the coach system prompt.
 * Server-only: use after auth; always scopes through the caller's Supabase session.
 *
 * `asOfLocalDate` must be the user's calendar day (from the client via
 * `localDateKey()`). Never derive "today" with server `localDateKey()` or
 * `toISOString().split('T')[0]` — Vercel runs in UTC and will shift the day
 * for anyone west of UTC.
 */
export async function buildCoachContext(
  supabase: SupabaseClient,
  userId: string,
  unitPreference: CoachUnitPreference,
  opts?: { asOfLocalDate: string; timeZone?: string | null },
): Promise<CoachContext> {
  const today = opts?.asOfLocalDate
  if (!today) {
    throw new Error('buildCoachContext requires asOfLocalDate from the client')
  }
  const timeZone = opts?.timeZone ?? null

  const [
    { data: profile },
    { data: stats },
    { data: dayTypeRows },
    { data: rotationRow },
    { data: flexRows },
    { data: restDayRows },
    { data: restDateRows },
    { data: bodyWeights },
    { data: sessions },
  ] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('display_name, username')
      .eq('id', userId)
      .maybeSingle(),
    supabase.from('user_stats').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('exercises').select('day_type').eq('user_id', userId),
    supabase.from('user_rotation').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('user_flex_days').select('day_key').eq('user_id', userId),
    supabase.from('user_rest_days').select('day_of_week').eq('user_id', userId),
    supabase
      .from('user_rest_dates')
      .select('rest_date')
      .eq('user_id', userId)
      .order('rest_date', { ascending: false })
      .limit(14),
    supabase
      .from('body_weights')
      .select('weight, recorded_at')
      .eq('user_id', userId)
      .order('recorded_at', { ascending: false })
      .limit(COACH_CONTEXT_BODY_WEIGHTS),
    supabase
      .from('sessions')
      .select('id, day_type, completed_at, local_date, xp_earned, note')
      .eq('user_id', userId)
      .not('completed_at', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(COACH_CONTEXT_SESSIONS),
  ])

  const dayKeys = Array.from(
    new Set((dayTypeRows ?? []).map((r: { day_type: string }) => r.day_type)),
  )
  const flexDays = new Set((flexRows ?? []).map((r: { day_key: string }) => r.day_key))
  const rotation = (rotationRow as UserRotation | null) ?? null
  const seq = effectiveSequence(rotation, dayKeys, flexDays)
  const upNext = nextDay(seq, rotation?.current_index ?? -1)

  const sessionList = (sessions ?? []) as SessionRow[]
  const sessionIds = sessionList.map(s => s.id)

  let logs: LogRow[] = []
  if (sessionIds.length > 0) {
    const { data: logRows } = await supabase
      .from('session_logs')
      .select(
        'session_id, set_number, weight, reps, is_pr, is_warmup, is_skipped, rpe, created_at, exercises(name)',
      )
      .in('session_id', sessionIds)
      .order('created_at', { ascending: true })
    logs = (logRows ?? []) as LogRow[]
  }

  const logsBySession = new Map<string, LogRow[]>()
  for (const log of logs) {
    if (log.is_skipped) continue
    const list = logsBySession.get(log.session_id) ?? []
    list.push(log)
    logsBySession.set(log.session_id, list)
  }

  const recent_sessions = sessionList.map(s => {
    const raw = logsBySession.get(s.id) ?? []
    const capped = raw.slice(0, COACH_CONTEXT_SETS_PER_SESSION)
    return {
      local_date: s.local_date,
      day_type: s.day_type,
      completed_at: s.completed_at,
      xp_earned: s.xp_earned ?? 0,
      note: s.note,
      sets: capped.map(l => ({
        exercise: exerciseName(l.exercises),
        set_number: l.set_number,
        weight_lbs: l.weight,
        reps: l.reps,
        is_pr: !!l.is_pr,
        is_warmup: !!l.is_warmup,
        rpe: l.rpe,
      })),
    }
  })

  // PRs from the same recent window first; if thin, one broader query.
  let recent_prs = logs
    .filter(l => l.is_pr && l.weight != null && l.reps != null && !l.is_skipped)
    .slice(0, COACH_CONTEXT_RECENT_PRS)
    .map(l => {
      const sess = sessionList.find(s => s.id === l.session_id)
      return {
        exercise: exerciseName(l.exercises),
        weight_lbs: l.weight as number,
        reps: l.reps as number,
        local_date: sess?.local_date ?? null,
        completed_at: sess?.completed_at ?? null,
      }
    })

  if (recent_prs.length < COACH_CONTEXT_RECENT_PRS) {
    const { data: prRows } = await supabase
      .from('session_logs')
      .select(
        'weight, reps, created_at, exercises(name), sessions!inner(user_id, local_date, completed_at)',
      )
      .eq('is_pr', true)
      .eq('sessions.user_id', userId)
      .not('weight', 'is', null)
      .order('created_at', { ascending: false })
      .limit(COACH_CONTEXT_RECENT_PRS)

    type PrJoin = {
      weight: number | null
      reps: number | null
      exercises: { name: string } | { name: string }[] | null
      sessions:
        | { user_id: string; local_date: string | null; completed_at: string | null }
        | { user_id: string; local_date: string | null; completed_at: string | null }[]
        | null
    }

    recent_prs = ((prRows ?? []) as PrJoin[])
      .filter(r => r.weight != null && r.reps != null)
      .map(r => {
        const sess = Array.isArray(r.sessions) ? r.sessions[0] : r.sessions
        return {
          exercise: exerciseName(r.exercises),
          weight_lbs: r.weight as number,
          reps: r.reps as number,
          local_date: sess?.local_date ?? null,
          completed_at: sess?.completed_at ?? null,
        }
      })
  }

  return {
    as_of_local_date: today,
    time_zone: timeZone,
    unit_preference: unitPreference,
    weight_storage: 'lbs',
    profile: {
      display_name: profile?.display_name ?? null,
      username: profile?.username ?? null,
    },
    stats: stats
      ? {
          xp_total: stats.xp_total ?? 0,
          level: stats.level ?? 1,
          current_streak: stats.current_streak ?? 0,
          longest_streak: stats.longest_streak ?? 0,
          last_workout_date: stats.last_workout_date ?? null,
          total_workouts: stats.total_workouts ?? 0,
        }
      : null,
    program: {
      days: dayKeys.sort(),
      rotation_mode: rotation?.mode ?? null,
      sequence: seq,
      current_index: rotation?.current_index ?? null,
      next_day: upNext,
    },
    rest: {
      weekly_days_of_week: (restDayRows ?? []).map(
        (r: { day_of_week: number }) => r.day_of_week,
      ),
      recent_one_off_dates: (restDateRows ?? []).map(
        (r: { rest_date: string }) => r.rest_date,
      ),
    },
    body_weight: {
      recent: (bodyWeights ?? []).map((r: { weight: number; recorded_at: string }) => ({
        date: r.recorded_at,
        weight_lbs: r.weight,
      })),
    },
    recent_sessions,
    recent_prs,
  }
}
