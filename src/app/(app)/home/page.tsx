import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import HomeDashboard from './HomeDashboard'
import { computeRotation } from '@/lib/utils/gamification'

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

  // Skip-aware rotation: recommend the day trained least recently and flag any
  // days that have fallen behind. This way, deviating from push→pull→legs (e.g.
  // doing an extra push instead of legs) doesn't drop the skipped day out of the
  // suggestion — it floats up as the recommendation and is flagged as overdue.
  const { data: dayRows } = await supabase
    .from('exercises')
    .select('day_type')

  const { data: completedForRotation } = await supabase
    .from('sessions')
    .select('day_type, completed_at')
    .eq('user_id', user.id)
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })

  // Most recent completion per day_type (rows are already newest-first).
  const lastTrainedByDay: Record<string, string | null> = {}
  for (const s of completedForRotation ?? []) {
    if (s.completed_at && !(s.day_type in lastTrainedByDay)) {
      lastTrainedByDay[s.day_type] = s.completed_at
    }
  }

  const dayTypes = [...new Set((dayRows ?? []).map(d => d.day_type))]
  const rotation = computeRotation(dayTypes, lastTrainedByDay)

  // Recommended next day (least recently trained); fall back to the simple
  // cycle from the last session when no workout days are defined yet.
  const nextDay = rotation.find(r => r.recommended)?.dayType
    ?? getNextDayTypeServer(lastSession?.day_type ?? null)

  // Exercises for the recommended day, to preview in the CTA.
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
      rotation={rotation}
      firstName={firstName}
      weeklyWorkouts={weeklyCount ?? 0}
      monthlyWorkouts={monthlyCount ?? 0}
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
