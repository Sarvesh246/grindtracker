import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import HomeDashboard from './HomeDashboard'
import type { UserRotation } from '@/lib/types'
import { effectiveSequence, nextDay as nextDayFromRotation } from '@/lib/utils/rotation'

export default async function HomePage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Parallelize independent dashboard reads. History uses bounded SQL aggregates
  // (docs/sql/20-production-hardening.sql) instead of fetching every session row.
  const [
    { data: profile },
    { data: stats },
    { data: activeRow },
    { data: lastSession },
    { data: dayTypeRows },
    { data: rotationRow },
    { data: flexRows },
    { data: history },
    { count: totalPRs },
    { data: restDayRows },
    { data: restDateRows },
  ] = await Promise.all([
    supabase.from('user_profiles').select('display_name, username').eq('id', user.id).maybeSingle(),
    supabase.from('user_stats').select('*').eq('user_id', user.id).maybeSingle(),
    supabase
      .from('sessions')
      .select('id, day_type, started_at')
      .eq('user_id', user.id)
      .is('completed_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('sessions')
      .select('*')
      .eq('user_id', user.id)
      .not('completed_at', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from('exercises').select('day_type'),
    supabase.from('user_rotation').select('*').eq('user_id', user.id).maybeSingle(),
    supabase.from('user_flex_days').select('day_key').eq('user_id', user.id),
    supabase.rpc('grind_home_history', { p_lookback_days: 90 }),
    supabase
      .from('session_logs')
      .select('sessions!inner(user_id)', { count: 'exact', head: true })
      .eq('is_pr', true)
      .eq('sessions.user_id', user.id),
    supabase.from('user_rest_days').select('day_of_week').eq('user_id', user.id),
    supabase.from('user_rest_dates').select('rest_date').eq('user_id', user.id),
  ])

  const fullName = ((user.user_metadata?.full_name as string) || profile?.display_name || '').trim()
  const firstName = fullName.split(/\s+/)[0] || profile?.username || 'there'

  // Working-set count only (skip markers never count toward save eligibility).
  let activeSession:
    | { id: string; day_type: string; started_at: string; loggedSets: number }
    | null = null
  if (activeRow) {
    const { count } = await supabase
      .from('session_logs')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', activeRow.id)
      .eq('is_skipped', false)
      .not('weight', 'is', null)
    activeSession = {
      id: activeRow.id,
      day_type: activeRow.day_type,
      started_at: activeRow.started_at,
      loggedSets: count ?? 0,
    }
  }

  let lastSessionLogs: { exercise_name: string; weight: number | null; sets: number; reps: number | null }[] = []
  if (lastSession) {
    const { data: logs } = await supabase
      .from('session_logs')
      .select('weight, reps, is_warmup, exercise_id, set_number, created_at, exercises(name)')
      .eq('session_id', lastSession.id)
      .order('created_at', { ascending: true })

    if (logs) {
      type LogRow = {
        exercise_name: string
        weight: number | null
        sets: number
        reps: number | null
        firstLoggedAt: string
      }
      const byExercise: Record<string, LogRow> = {}
      for (const log of logs) {
        const exercises = log.exercises as unknown as { name: string }[] | { name: string } | null
        const name = (Array.isArray(exercises) ? exercises[0]?.name : exercises?.name) ?? 'Unknown'
        if (!byExercise[log.exercise_id]) {
          byExercise[log.exercise_id] = {
            exercise_name: name,
            weight: null,
            sets: 0,
            reps: null,
            firstLoggedAt: log.created_at,
          }
        }
        if (log.is_warmup) continue
        const entry = byExercise[log.exercise_id]
        entry.sets += 1
        if (log.weight !== null && (entry.weight === null || log.weight > entry.weight)) {
          entry.weight = log.weight
          entry.reps = log.reps
        }
      }
      lastSessionLogs = Object.values(byExercise)
        .sort((a, b) => a.firstLoggedAt.localeCompare(b.firstLoggedAt))
        .map(({ firstLoggedAt: _, ...row }) => row)
    }
  }

  const dayKeys = Array.from(new Set((dayTypeRows ?? []).map(r => r.day_type)))
  const rotation = (rotationRow as UserRotation | null)
  const flexDays = new Set((flexRows ?? []).map(r => r.day_key))
  const seq = effectiveSequence(rotation, dayKeys, flexDays)
  const nextDay = nextDayFromRotation(seq, rotation?.current_index ?? -1) ?? dayKeys.sort()[0] ?? 'push'

  const historyPayload = (history ?? {}) as {
    last_trained_by_day?: Record<string, string | null>
    recent_local_dates?: string[]
  }
  const lastTrainedByDay: Record<string, string | null> = {}
  for (const key of dayKeys) lastTrainedByDay[key] = null
  const rpcLast = historyPayload.last_trained_by_day ?? {}
  for (const [k, v] of Object.entries(rpcLast)) {
    if (k in lastTrainedByDay || dayKeys.includes(k)) lastTrainedByDay[k] = v
  }

  const { data: nextDayExercises } = await supabase
    .from('exercises')
    .select('name')
    .eq('day_type', nextDay)
    .eq('active', true)
    .order('sort_order', { ascending: true })

  // completedAt stays as local_date strings so week/month bucketing is timezone-safe.
  const completedLocalDates = historyPayload.recent_local_dates ?? []

  return (
    <HomeDashboard
      stats={stats}
      recurringRestDays={(restDayRows ?? []).map(r => r.day_of_week)}
      restDates={(restDateRows ?? []).map(r => r.rest_date)}
      activeSession={activeSession}
      lastSession={lastSession ?? null}
      lastSessionLogs={lastSessionLogs}
      nextDay={nextDay}
      nextDayExercises={(nextDayExercises ?? []).map(e => e.name)}
      hasDays={dayKeys.length > 0}
      rotationSeq={seq}
      rotationIndex={rotation?.current_index ?? -1}
      lastTrainedByDay={lastTrainedByDay}
      firstName={firstName}
      completedAt={completedLocalDates}
      totalPRs={totalPRs ?? 0}
    />
  )
}
