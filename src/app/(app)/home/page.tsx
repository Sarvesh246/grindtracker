import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import HomeDashboard from './HomeDashboard'

export default async function HomePage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

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
  let lastSessionLogs: { exercise_name: string; weight: number | null }[] = []
  if (lastSession) {
    const { data: logs } = await supabase
      .from('session_logs')
      .select('weight, exercise_id, set_number, exercises(name)')
      .eq('session_id', lastSession.id)
      .order('set_number', { ascending: true })

    if (logs) {
      // One row per exercise — take the max weight logged per exercise
      const byExercise: Record<string, { exercise_name: string; weight: number | null }> = {}
      for (const log of logs) {
        const exercises = log.exercises as unknown as { name: string }[] | { name: string } | null
        const name = (Array.isArray(exercises) ? exercises[0]?.name : exercises?.name) ?? 'Unknown'
        if (!byExercise[log.exercise_id]) {
          byExercise[log.exercise_id] = { exercise_name: name, weight: log.weight }
        } else {
          const current = byExercise[log.exercise_id].weight
          if (log.weight !== null && (current === null || log.weight > current)) {
            byExercise[log.exercise_id].weight = log.weight
          }
        }
      }
      lastSessionLogs = Object.values(byExercise)
    }
  }

  // Exercises for the next suggested day (to show preview in CTA)
  const nextDay = getNextDayTypeServer(lastSession?.day_type ?? null)
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
      weeklyWorkouts={weeklyCount ?? 0}
      totalPRs={totalPRs ?? 0}
    />
  )
}

function getNextDayTypeServer(lastDayType: string | null): 'push' | 'pull' | 'legs' {
  if (!lastDayType) return 'push'
  const cycle: Record<string, 'push' | 'pull' | 'legs'> = {
    push: 'pull', pull: 'legs', legs: 'push',
  }
  return cycle[lastDayType] ?? 'push'
}

function getWeekStart(): Date {
  const now = new Date()
  const day = now.getDay()
  const diff = now.getDate() - day + (day === 0 ? -6 : 1) // Monday
  const monday = new Date(now.setDate(diff))
  monday.setHours(0, 0, 0, 0)
  return monday
}
