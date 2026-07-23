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

  // The row is seeded by the `seed_user_stats` trigger on signup and backfilled
  // for existing accounts (docs/sql/11-server-side-xp.sql), so the client no
  // longer creates it — and no longer has the privilege to. A missing row is
  // handled downstream as "no stats yet" rather than being papered over here.
  const { data: stats } = await supabase
    .from('user_stats')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  // Stale-streak reset (if the last workout was more than 1 day ago) is done
  // client-side in HomeDashboard, using the viewer's own local date — this
  // server component runs on the server's clock/timezone, which for a global
  // user base is very often NOT the viewer's, and would zero (or fail to zero)
  // the streak up to a day early/late around the boundary. Same reasoning as
  // `overdueDays` below, which was already moved client-side for this exact
  // class of bug.

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
      .select('weight, reps, is_warmup, exercise_id, set_number, created_at, exercises(name)')
      .eq('session_id', lastSession.id)
      .order('created_at', { ascending: true })

    if (logs) {
      // One row per exercise — count working sets and take the heaviest working
      // set's weight + reps for the "sets × reps" summary (warm-ups excluded).
      // Preserve the order the user logged sets (first created_at per exercise).
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

  // Suggested next day, from the user's rotation. Auto mode derives the order from
  // their days (each once); manual mode follows their saved sequence (which may
  // repeat a day). Falls back gracefully for users with no rotation row yet.
  const [{ data: dayTypeRows }, { data: rotationRow }, { data: flexRows }] = await Promise.all([
    supabase.from('exercises').select('day_type'),
    supabase.from('user_rotation').select('*').eq('user_id', user.id).maybeSingle(),
    supabase.from('user_flex_days').select('day_key').eq('user_id', user.id),
  ])
  const dayKeys = Array.from(new Set((dayTypeRows ?? []).map(r => r.day_type)))
  const rotation = (rotationRow as UserRotation | null)
  const flexDays = new Set((flexRows ?? []).map(r => r.day_key))
  const seq = effectiveSequence(rotation, dayKeys, flexDays)
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

  // Weekly/monthly workout counts are bucketed client-side (HomeDashboard) from
  // `completedDays` below, using the viewer's local week/month boundaries —
  // same timezone reasoning as the streak reset above.

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
      hasDays={dayKeys.length > 0}
      rotationSeq={seq}
      rotationIndex={rotation?.current_index ?? -1}
      lastTrainedByDay={lastTrainedByDay}
      firstName={firstName}
      completedAt={(completedDays ?? []).map(r => r.completed_at).filter((v): v is string => v !== null)}
      totalPRs={totalPRs ?? 0}
    />
  )
}
