import type { SupabaseClient } from '@supabase/supabase-js'
import type { DayCategory, UserRotation } from '@/lib/types'
import { ALL_BADGES } from '@/lib/utils/badges'
import { effectiveSequence, nextDay } from '@/lib/utils/rotation'
import {
  summarizeBodyWeight,
  summarizeRpe,
  rollupSessionExercises,
  type RawSetForSummary,
} from './contextSummaries'
import {
  COACH_CONTEXT_BODY_WEIGHTS,
  COACH_CONTEXT_BODY_WEIGHTS_FETCH,
  COACH_CONTEXT_EXERCISE_BESTS,
  COACH_CONTEXT_FULL_DETAIL_SESSIONS,
  COACH_CONTEXT_RECENT_PRS,
  COACH_CONTEXT_SESSIONS,
  COACH_CONTEXT_SETS_PER_SESSION,
} from './constants'
import {
  summarizeTrainingHistory,
  type TrainingHistorySummary,
} from './trainingHistory'

export type CoachUnitPreference = 'lbs' | 'kg'

export interface CoachCatalogExercise {
  name: string
  sets_target: number
  reps_target: string
  weight_target_lbs: number | null
  sort_order: number
}

export interface CoachExercisePerformance {
  name: string
  day_type: string
  max_weight_lbs: number | null
  max_volume: number | null
  last_weight_lbs: number | null
  weight_target_lbs: number | null
}

export interface CoachSetDetail {
  exercise: string
  set_number: number
  weight_lbs: number | null
  reps: number | null
  is_pr: boolean
  is_warmup: boolean
  rpe: number | null
  note: string | null
}

export interface CoachRecentSession {
  local_date: string | null
  day_type: string
  completed_at: string | null
  xp_earned: number
  note: string | null
  /** Present on the newest sessions — full set rows. */
  sets?: CoachSetDetail[]
  /** Present on older sessions — per-exercise rollup (token-cheap). */
  exercises?: ReturnType<typeof rollupSessionExercises>
  detail: 'full' | 'rollup'
}

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
    joined_at: string | null
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
    flex_days: string[]
    day_categories: Record<string, DayCategory>
    rotation_mode: 'auto' | 'manual' | null
    sequence: string[]
    current_index: number | null
    next_day: string | null
    next_day_exercises: CoachCatalogExercise[]
  }
  rest: {
    weekly_days_of_week: number[]
    /** 0=Sun..6=Sat labels for the model. */
    weekly_day_names: string[]
    recent_one_off_dates: string[]
  }
  catalog: {
    inactive_count: number
    days: { day_type: string; exercises: CoachCatalogExercise[] }[]
  }
  /** Active-exercise bests + last-session working weight + targets. */
  exercise_performance: CoachExercisePerformance[]
  lifetime: {
    total_volume_lbs: number
    max_set_weight_lbs: number
    max_set_reps: number
    unique_exercises: number
    total_prs: number
    total_sets: number
    days_active: number
    body_weight_log_count: number
    has_accepted_friend: boolean
  }
  badges: {
    earned_count: number
    earned: { id: string; name: string }[]
  }
  schedule: {
    /** Last completed local_date per day_type (null = never in lookback / ever). */
    last_trained_by_day: Record<string, string | null>
  }
  body_weight: {
    summary: ReturnType<typeof summarizeBodyWeight>['summary']
    recent: { date: string; weight_lbs: number }[]
  }
  rpe: ReturnType<typeof summarizeRpe>
  active_session: {
    day_type: string
    started_at: string
    logged_working_sets: number
    /** Day catalog + any logged exercises; lean per-exercise progress. */
    exercises: {
      name: string
      working_sets: number
      last_weight_lbs: number | null
      last_reps: number | null
    }[]
  } | null
  photos: {
    group_count: number
    latest_date: string | null
    latest_day_type: string | null
    latest_note: string | null
  }
  /**
   * Tenure + layoff snapshot derived from all completed-session local dates.
   * Use for timelines / “how long have I been training” — recent_sessions alone
   * is too short a window for that.
   */
  training_history: TrainingHistorySummary
  recent_sessions: CoachRecentSession[]
  recent_prs: {
    exercise: string
    weight_lbs: number
    reps: number
    local_date: string | null
    completed_at: string | null
  }[]
}

const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

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
  note: string | null
  created_at: string
  exercises: { name: string } | { name: string }[] | null
}

type ExerciseRow = {
  id: string
  name: string
  day_type: string
  sets_target: number
  reps_target: string
  weight_target: number | null
  sort_order: number
  active: boolean
}

function exerciseName(exercises: LogRow['exercises']): string {
  if (!exercises) return 'Unknown'
  if (Array.isArray(exercises)) return exercises[0]?.name ?? 'Unknown'
  return exercises.name ?? 'Unknown'
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
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
    { data: exerciseRows },
    { data: rotationRow },
    { data: flexRows },
    { data: restDayRows },
    { data: restDateRows },
    { data: categoryRows },
    { data: bodyWeights },
    { data: sessions },
    { data: historyDateRows },
    { data: badgeMetrics },
    { data: homeHistory },
    { data: friendProfile },
    { data: activeRow },
    { count: photoCount },
    { data: latestPhoto },
  ] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('display_name, username, created_at')
      .eq('id', userId)
      .maybeSingle(),
    supabase.from('user_stats').select('*').eq('user_id', userId).maybeSingle(),
    supabase
      .from('exercises')
      .select(
        'id, name, day_type, sets_target, reps_target, weight_target, sort_order, active',
      )
      .eq('user_id', userId)
      .order('sort_order', { ascending: true }),
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
      .from('user_day_categories')
      .select('day_key, category')
      .eq('user_id', userId),
    supabase
      .from('body_weights')
      .select('weight, recorded_at')
      .eq('user_id', userId)
      .order('recorded_at', { ascending: false })
      .limit(COACH_CONTEXT_BODY_WEIGHTS_FETCH),
    supabase
      .from('sessions')
      .select('id, day_type, completed_at, local_date, xp_earned, note')
      .eq('user_id', userId)
      .not('completed_at', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(COACH_CONTEXT_SESSIONS),
    // Date-only scan for tenure / layoff summary (not set detail).
    supabase
      .from('sessions')
      .select('local_date')
      .eq('user_id', userId)
      .not('completed_at', 'is', null)
      .not('local_date', 'is', null)
      .order('local_date', { ascending: true })
      .limit(4000),
    supabase.rpc('grind_badge_metrics'),
    supabase.rpc('grind_home_history', { p_lookback_days: 90 }),
    supabase.rpc('get_friend_profile', { p_user_id: userId }),
    supabase
      .from('sessions')
      .select('id, day_type, started_at')
      .eq('user_id', userId)
      .is('completed_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('progress_photo_groups')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId),
    supabase
      .from('progress_photo_groups')
      .select('taken_date, day_type, note')
      .eq('user_id', userId)
      .order('taken_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const allExercises = (exerciseRows ?? []) as ExerciseRow[]
  const activeExercises = allExercises.filter(e => e.active)
  const inactive_count = allExercises.length - activeExercises.length

  const dayKeys = Array.from(new Set(allExercises.map(e => e.day_type))).sort()
  const flexDays = (flexRows ?? []).map((r: { day_key: string }) => r.day_key).sort()
  const flexSet = new Set(flexDays)
  const rotation = (rotationRow as UserRotation | null) ?? null
  const seq = effectiveSequence(rotation, dayKeys, flexSet)
  const upNext = nextDay(seq, rotation?.current_index ?? -1)

  const day_categories: Record<string, DayCategory> = {}
  for (const row of (categoryRows ?? []) as { day_key: string; category: DayCategory }[]) {
    day_categories[row.day_key] = row.category
  }

  const catalogByDay = new Map<string, CoachCatalogExercise[]>()
  for (const e of activeExercises) {
    const list = catalogByDay.get(e.day_type) ?? []
    list.push({
      name: e.name,
      sets_target: e.sets_target,
      reps_target: e.reps_target,
      weight_target_lbs: e.weight_target,
      sort_order: e.sort_order,
    })
    catalogByDay.set(e.day_type, list)
  }
  const catalogDays = dayKeys
    .filter(d => catalogByDay.has(d))
    .map(day_type => ({
      day_type,
      exercises: catalogByDay.get(day_type)!,
    }))

  const next_day_exercises =
    upNext && catalogByDay.has(upNext) ? catalogByDay.get(upNext)! : []

  // Bests / last weights for active catalog (capped).
  const perfIds = activeExercises
    .slice(0, COACH_CONTEXT_EXERCISE_BESTS)
    .map(e => e.id)
  const bestsMap = new Map<string, { max_weight: number; max_volume: number }>()
  const lastMap = new Map<string, number>()
  if (perfIds.length > 0) {
    const [{ data: bestRows }, { data: lastRows }] = await Promise.all([
      supabase.rpc('get_exercise_bests', { p_exercise_ids: perfIds }),
      supabase.rpc('get_exercise_last_weights', { p_exercise_ids: perfIds }),
    ])
    for (const r of (bestRows ?? []) as {
      exercise_id: string
      max_weight: number | string | null
      max_volume: number | string | null
    }[]) {
      bestsMap.set(r.exercise_id, {
        max_weight: num(r.max_weight),
        max_volume: num(r.max_volume),
      })
    }
    for (const r of (lastRows ?? []) as {
      exercise_id: string
      last_weight: number | string | null
    }[]) {
      lastMap.set(r.exercise_id, num(r.last_weight))
    }
  }

  const exercise_performance: CoachExercisePerformance[] = activeExercises
    .slice(0, COACH_CONTEXT_EXERCISE_BESTS)
    .map(e => {
      const b = bestsMap.get(e.id)
      return {
        name: e.name,
        day_type: e.day_type,
        max_weight_lbs: b ? b.max_weight : null,
        max_volume: b ? b.max_volume : null,
        last_weight_lbs: lastMap.has(e.id) ? lastMap.get(e.id)! : null,
        weight_target_lbs: e.weight_target,
      }
    })

  const sessionList = (sessions ?? []) as SessionRow[]
  const sessionIds = sessionList.map(s => s.id)

  let logs: LogRow[] = []
  if (sessionIds.length > 0) {
    const { data: logRows } = await supabase
      .from('session_logs')
      .select(
        'session_id, set_number, weight, reps, is_pr, is_warmup, is_skipped, rpe, note, created_at, exercises(name)',
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

  const allRawSets: RawSetForSummary[] = []
  const recent_sessions: CoachRecentSession[] = sessionList.map((s, idx) => {
    const raw = logsBySession.get(s.id) ?? []
    const mapped: RawSetForSummary[] = raw.map(l => ({
      exercise: exerciseName(l.exercises),
      set_number: l.set_number,
      weight_lbs: l.weight,
      reps: l.reps,
      is_pr: !!l.is_pr,
      is_warmup: !!l.is_warmup,
      rpe: l.rpe,
      note: l.note,
    }))
    allRawSets.push(...mapped)

    const base = {
      local_date: s.local_date,
      day_type: s.day_type,
      completed_at: s.completed_at,
      xp_earned: s.xp_earned ?? 0,
      note: s.note,
    }

    if (idx < COACH_CONTEXT_FULL_DETAIL_SESSIONS) {
      return {
        ...base,
        detail: 'full' as const,
        sets: mapped.slice(0, COACH_CONTEXT_SETS_PER_SESSION).map(l => ({
          exercise: l.exercise,
          set_number: l.set_number,
          weight_lbs: l.weight_lbs,
          reps: l.reps,
          is_pr: l.is_pr,
          is_warmup: l.is_warmup,
          rpe: l.rpe,
          note: l.note?.trim() ? l.note.trim().slice(0, 120) : null,
        })),
      }
    }
    return {
      ...base,
      detail: 'rollup' as const,
      exercises: rollupSessionExercises(mapped),
    }
  })

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

  let active_session: CoachContext['active_session'] = null
  if (activeRow) {
    const { data: activeLogRows } = await supabase
      .from('session_logs')
      .select(
        'weight, reps, is_warmup, is_skipped, created_at, exercises(name)',
      )
      .eq('session_id', activeRow.id)
      .order('created_at', { ascending: true })

    type ActiveLog = {
      weight: number | null
      reps: number | null
      is_warmup: boolean | null
      is_skipped: boolean | null
      created_at: string
      exercises: LogRow['exercises']
    }

    type ActiveExAcc = {
      name: string
      working_sets: number
      last_weight_lbs: number | null
      last_reps: number | null
      order: number
    }

    const byName = new Map<string, ActiveExAcc>()
    let logged_working_sets = 0
    let order = 0

    // Seed with today's catalog so the model sees planned exercises, not only
    // ones already logged (helps "what to skip" / mid-session advice).
    for (const e of activeExercises.filter(
      x => x.day_type === activeRow.day_type,
    )) {
      if (byName.has(e.name)) continue
      byName.set(e.name, {
        name: e.name,
        working_sets: 0,
        last_weight_lbs: null,
        last_reps: null,
        order: e.sort_order,
      })
    }

    for (const log of (activeLogRows ?? []) as ActiveLog[]) {
      const name = exerciseName(log.exercises)
      let entry = byName.get(name)
      if (!entry) {
        entry = {
          name,
          working_sets: 0,
          last_weight_lbs: null,
          last_reps: null,
          // Logged-only extras (swaps) after catalog order.
          order: 10_000 + order++,
        }
        byName.set(name, entry)
      }
      if (log.is_skipped) continue
      if (log.weight == null) continue
      if (!log.is_warmup) {
        logged_working_sets += 1
        entry.working_sets += 1
        entry.last_weight_lbs = log.weight
        entry.last_reps = log.reps
      } else if (entry.last_weight_lbs == null) {
        // Warm-up-only so far — still useful as a last-seen load.
        entry.last_weight_lbs = log.weight
        entry.last_reps = log.reps
      }
    }

    active_session = {
      day_type: activeRow.day_type,
      started_at: activeRow.started_at,
      logged_working_sets,
      exercises: [...byName.values()]
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
        .slice(0, 24)
        .map(({ name, working_sets, last_weight_lbs, last_reps }) => ({
          name,
          working_sets,
          last_weight_lbs,
          last_reps,
        })),
    }
  }

  const metrics = (badgeMetrics ?? {}) as Record<string, unknown>
  const friend = (friendProfile ?? {}) as Record<string, unknown>
  const historyPayload = (homeHistory ?? {}) as {
    last_trained_by_day?: Record<string, string | null>
    days_active?: number
  }

  const last_trained_by_day: Record<string, string | null> = {}
  for (const key of dayKeys) last_trained_by_day[key] = null
  for (const [k, v] of Object.entries(historyPayload.last_trained_by_day ?? {})) {
    last_trained_by_day[k] = v
  }

  const badgeIds = Array.isArray(friend.badge_ids)
    ? (friend.badge_ids as string[])
    : []
  const badgeLabel = new Map(ALL_BADGES.map(b => [b.id, b.label]))
  const earned = badgeIds.map(id => ({
    id,
    name: badgeLabel.get(id) ?? id,
  }))

  const weekly = ((restDayRows ?? []) as { day_of_week: number }[]).map(
    r => r.day_of_week,
  )

  const bw = summarizeBodyWeight(
    ((bodyWeights ?? []) as { weight: number; recorded_at: string }[]).map(r => ({
      date: r.recorded_at,
      weight_lbs: r.weight,
    })),
    today,
    COACH_CONTEXT_BODY_WEIGHTS,
  )

  return {
    as_of_local_date: today,
    time_zone: timeZone,
    unit_preference: unitPreference,
    weight_storage: 'lbs',
    profile: {
      display_name: profile?.display_name ?? null,
      username: profile?.username ?? null,
      joined_at: profile?.created_at ?? (typeof friend.joined_at === 'string' ? friend.joined_at : null),
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
      days: dayKeys,
      flex_days: flexDays,
      day_categories,
      rotation_mode: rotation?.mode ?? null,
      sequence: seq,
      current_index: rotation?.current_index ?? null,
      next_day: upNext,
      next_day_exercises,
    },
    rest: {
      weekly_days_of_week: weekly,
      weekly_day_names: weekly
        .filter(d => d >= 0 && d <= 6)
        .map(d => DOW_NAMES[d]!),
      recent_one_off_dates: (restDateRows ?? []).map(
        (r: { rest_date: string }) => r.rest_date,
      ),
    },
    catalog: {
      inactive_count,
      days: catalogDays,
    },
    exercise_performance,
    lifetime: {
      total_volume_lbs: num(metrics.total_volume),
      max_set_weight_lbs: num(metrics.max_set_weight),
      max_set_reps: num(metrics.max_set_reps),
      unique_exercises: num(metrics.unique_exercise_count),
      total_prs: num(friend.total_prs),
      total_sets: num(friend.total_sets),
      days_active: num(friend.days_active ?? historyPayload.days_active),
      body_weight_log_count: num(metrics.body_weight_log_count),
      has_accepted_friend: !!metrics.has_accepted_friend,
    },
    badges: {
      earned_count: earned.length,
      earned,
    },
    schedule: { last_trained_by_day },
    body_weight: {
      summary: bw.summary,
      recent: bw.recent,
    },
    rpe: summarizeRpe(allRawSets),
    active_session,
    photos: {
      group_count: photoCount ?? 0,
      latest_date: latestPhoto?.taken_date ?? null,
      latest_day_type: latestPhoto?.day_type ?? null,
      latest_note: latestPhoto?.note ?? null,
    },
    training_history: summarizeTrainingHistory(
      ((historyDateRows ?? []) as { local_date: string | null }[]).map(r => r.local_date),
      today,
    ),
    recent_sessions,
    recent_prs,
  }
}
