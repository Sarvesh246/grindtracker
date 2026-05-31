import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import HomeDashboard from './HomeDashboard'
import type { UserRotation } from '@/lib/types'
import { effectiveSequence, nextDay as nextDayFromRotation } from '@/lib/utils/rotation'

export default async function HomePage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // First name for the greeting — prefer the OAuth full name, then the app
  // profile's display name, then the username, then a neutral fallback.
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('display_name, username')
    .eq('id', user.id)
    .maybeSingle()

  const fullName = ((user.user_metadata?.full_name as string) || profile?.display_name || '').trim()
  const firstName = fullName.split(/\s+/)[0] || profile?.username || 'there'

  // Get or create user_stats
  let { data: stats } = await supabase
    .from('user_stats')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!stats) {
    const { data: newStats } = await supabase
      .from('user_stats')
      .insert({ user_id: user.id })
      .select()
      .maybeSingle()
    stats = newStats
  }

  // Reset stale streak: if last workout was more than 2 days ago, streak should be 0
  if (stats && stats.current_streak > 0 && stats.last_workout_date) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const lastDate = new Date(stats.last_workout_date + 'T12:00:00')
    lastDate.setHours(0, 0, 0, 0)
    const diffDays = Math.round((today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24))
    if (diffDays > 1) {
      await supabase.from('user_stats').update({ current_streak: 0 }).eq('user_id', user.id)
      stats = { ...stats, current_streak: 0 }
    }
  }

  // Last completed session
  const { data: lastSession } = await supabase
    .from('sessions')
    .select('*')
    .eq('user_id', user.id)
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Session logs for last session (with exercise names)
  let lastSessionLogs: { exercise_name: string; weight: number | null; sets: number; reps: number | null }[] = []
  if (lastSession) {
    const { data: logs } = await supabase
      .from('session_logs')
      .select('weight, reps, is_warmup, exercise_id, set_number, exercises(name)')
      .eq('session_id', lastSession.id)
      .order('set_number', { ascending: true })

    if (logs) {
      // One row per exercise — count working sets and take the heaviest working
      // set's weight + reps for the "sets × reps" summary (warm-ups excluded).
      const byExercise: Record<string, { exercise_name: string; weight: number | null; sets: number; reps: number | null }> = {}
      for (const log of logs) {
        const exercises = log.exercises as unknown as { name: string }[] | { name: string } | null
        const name = (Array.isArray(exercises) ? exercises[0]?.name : exercises?.name) ?? 'Unknown'
        if (!byExercise[log.exercise_id]) {
          byExercise[log.exercise_id] = { exercise_name: name, weight: null, sets: 0, reps: null }
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
    }
  }

  // Suggested next day, from the user's rotation. Auto mode derives the order from
  // their days (each once); manual mode follows their saved sequence (which may
  // repeat a day). Falls back gracefully for users with no rotation row yet.
  const [{ data: dayTypeRows }, { data: rotationRow }] = await Promise.all([
    supabase.from('exercises').select('day_type'),
    supabase.from('user_rotation').select('*').eq('user_id', user.id).maybeSingle(),
  ])
  const dayKeys = Array.from(new Set((dayTypeRows ?? []).map(r => r.day_type)))
  const rotation = (rotationRow as UserRotation | null)
  const seq = effectiveSequence(rotation, dayKeys)
  const nextDay = nextDayFromRotation(seq, rotation?.current_index ?? -1) ?? dayKeys.sort()[0] ?? 'push'

  // Last completed date per day_key, for the home rotation's recency/overdue
  // info. Surfaces how long since you trained each day (and flags skipped ones)
  // WITHOUT changing which day is suggested next — that stays position-driven.
  const { data: completedDays } = await supabase
    .from('sessions')
    .select('day_type, completed_at')
    .eq('user_id', user.id)
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })

  const lastTrainedByDay: Record<string, string | null> = {}
  for (const key of dayKeys) lastTrainedByDay[key] = null
  for (const row of completedDays ?? []) {
    // Rows are newest-first, so the first time we see a day_type is its latest.
    if (lastTrainedByDay[row.day_type] == null && row.completed_at) {
      lastTrainedByDay[row.day_type] = row.completed_at
    }
  }

  // Exercises for the next suggested day (to show preview in CTA)
  const { data: nextDayExercises } = await supabase
    .from('exercises')
    .select('name')
    .eq('day_type', nextDay)
    .order('sort_order', { ascending: true })

  // Stats: workouts this week
  const weekStart = getWeekStart()
  const { count: weeklyCount } = await supabase
    .from('sessions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .not('completed_at', 'is', null)
    .gte('completed_at', weekStart.toISOString())

  // Stats: workouts this month
  const monthStart = getMonthStart()
  const { count: monthlyCount } = await supabase
    .from('sessions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .not('completed_at', 'is', null)
    .gte('completed_at', monthStart.toISOString())

  // Total PRs
  const { count: totalPRs } = await supabase
    .from('session_logs')
    .select('sessions!inner(user_id)', { count: 'exact', head: true })
    .eq('is_pr', true)
    .eq('sessions.user_id', user.id)

  return (
    <HomeDashboard
      stats={stats}
      lastSession={lastSession ?? null}
      lastSessionLogs={lastSessionLogs}
      nextDay={nextDay}
      nextDayExercises={(nextDayExercises ?? []).map(e => e.name)}
      rotationSeq={seq}
      rotationIndex={rotation?.current_index ?? -1}
      lastTrainedByDay={lastTrainedByDay}
      firstName={firstName}
      weeklyWorkouts={weeklyCount ?? 0}
      monthlyWorkouts={monthlyCount ?? 0}
      totalPRs={totalPRs ?? 0}
    />
  )
}

function getMonthStart(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1)
}

function getWeekStart(): Date {
  const now = new Date()
  const day = now.getDay()
  const diff = now.getDate() - day + (day === 0 ? -6 : 1) // Monday
  const monday = new Date(now.setDate(diff))
  monday.setHours(0, 0, 0, 0)
  return monday
}
