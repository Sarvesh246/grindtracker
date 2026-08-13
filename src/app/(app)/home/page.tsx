import { cookies } from 'next/headers'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import HomeDashboard from './HomeDashboard'
import type { UserRotation } from '@/lib/types'
import { effectiveSequence, nextDay as nextDayFromRotation } from '@/lib/utils/rotation'
import { isAdminEmail } from '@/lib/utils/admin'
import {
  DEMO_IDENTITY,
  DEMO_TOTAL_PRS,
  DEMO_LAST_SESSION_LOGS,
  demoHomeStats,
  demoLastSession,
  demoCompletedLocalDates,
} from '@/lib/demoMode/fakeData'

export default async function HomePage() {
  const supabase = await createClient()

  const user = await getAuthUser()
  if (!user) redirect('/login')

  // Parallelize independent dashboard reads. History uses bounded SQL aggregates
  // (docs/sql/20-production-hardening.sql) instead of fetching every session row.
  const [
    { data: profile },
    { data: stats },
    { data: activeRows },
    { data: lastSession },
    { data: dayTypeRows },
    { data: rotationRow },
    { data: flexRows },
    { data: history, error: historyError },
    { count: totalPRs },
    { data: restDayRows },
    { data: restDateRows },
    { data: restCancelRows },
  ] = await Promise.all([
    supabase.from('user_profiles').select('display_name, username').eq('id', user.id).maybeSingle(),
    supabase.from('user_stats').select('*').eq('user_id', user.id).maybeSingle(),
    supabase
      .from('sessions')
      .select('id, day_type, started_at')
      .eq('user_id', user.id)
      .is('completed_at', null)
      .order('started_at', { ascending: false })
      .limit(10),
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
    supabase.from('user_rest_days').select('day_of_week, effective_from').eq('user_id', user.id),
    supabase.from('user_rest_dates').select('rest_date').eq('user_id', user.id),
    supabase.from('user_rest_cancels').select('rest_date').eq('user_id', user.id),
  ])

  const demoModePref = (await cookies()).get('grind_demo_mode_pref')?.value
  const demoMode = demoModePref === 'on' && isAdminEmail(user.email)

  const fullName = ((user.user_metadata?.full_name as string) || profile?.display_name || '').trim()
  const firstName = demoMode
    ? DEMO_IDENTITY.displayName.split(/\s+/)[0]
    : fullName.split(/\s+/)[0] || profile?.username || 'there'

  // Working-set count only (skip markers never count toward save eligibility).
  // Fetch every open session (cap 10) so overnight orphans aren't hidden when
  // another day-type session is also incomplete.
  const activeSessions: {
    id: string
    day_type: string
    started_at: string
    loggedSets: number
  }[] = []
  for (const row of activeRows ?? []) {
    const { count } = await supabase
      .from('session_logs')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', row.id)
      .eq('is_skipped', false)
      .eq('is_warmup', false)
      .not('weight', 'is', null)
    activeSessions.push({
      id: row.id,
      day_type: row.day_type,
      started_at: row.started_at,
      loggedSets: count ?? 0,
    })
  }

  let lastSessionLogs: { exercise_name: string; weight: number | null; sets: number; reps: number | null }[] = []
  if (lastSession) {
    const { data: logs } = await supabase
      .from('session_logs')
      .select('weight, reps, is_warmup, is_skipped, exercise_id, set_number, created_at, exercises(name)')
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
        // Working sets only — skip markers and warm-ups never count toward
        // the Last Workout set tally (same filter as activeSession.loggedSets).
        if (log.is_warmup || log.is_skipped || log.weight === null) continue
        const entry = byExercise[log.exercise_id]
        entry.sets += 1
        if (entry.weight === null || log.weight > entry.weight) {
          entry.weight = log.weight
          entry.reps = log.reps
        }
      }
      // Drop exercises that only had skips/warm-ups (sets === 0).
      lastSessionLogs = Object.values(byExercise)
        .filter(row => row.sets > 0)
        .sort((a, b) => a.firstLoggedAt.localeCompare(b.firstLoggedAt))
        .map(({ firstLoggedAt: _, ...row }) => row)
    }
  }

  const dayKeys = Array.from(new Set((dayTypeRows ?? []).map(r => r.day_type)))
  const rotation = (rotationRow as UserRotation | null)
  const flexDays = new Set((flexRows ?? []).map(r => r.day_key))
  const seq = effectiveSequence(rotation, dayKeys, flexDays)
  const nextDay = nextDayFromRotation(seq, rotation?.current_index ?? -1) ?? dayKeys.sort()[0] ?? 'push'

  // grind_home_history backs "This Week"/"This Month" counts, the overdue-day
  // nudge, and last-trained-per-day — a silently blank result here is
  // indistinguishable from a genuinely brand-new account, so log the failure
  // rather than let it pass as if there were nothing to show.
  if (historyError) {
    console.error('[grind] grind_home_history failed', historyError)
  }
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

  // Demo Mode fabricates level/streak/workout numbers, the last-session band,
  // and recent activity — never the real ones. Day/rotation/exercise
  // structure (nextDay, rotationSeq, lastTrainedByDay, rest days) stays real:
  // it's app configuration, not personal identity or performance data.
  // activeSessions is forced empty so the resume banner (and its real writes,
  // see HomeDashboard.handleSaveActive/handleExitActive) never renders.
  return (
    <HomeDashboard
      stats={demoMode ? demoHomeStats() : stats}
      recurringRestDays={(restDayRows ?? []).map(r => r.day_of_week)}
      restDates={(restDateRows ?? []).map(r => r.rest_date)}
      restCancels={(restCancelRows ?? []).map(r => r.rest_date)}
      restEffectiveFrom={Object.fromEntries(
        (restDayRows ?? [])
          .filter(r => r.effective_from && r.effective_from !== '1970-01-01')
          .map(r => [r.day_of_week, r.effective_from as string]),
      )}
      activeSessions={demoMode ? [] : activeSessions}
      lastSession={demoMode ? demoLastSession() : (lastSession ?? null)}
      lastSessionLogs={demoMode ? DEMO_LAST_SESSION_LOGS : lastSessionLogs}
      nextDay={nextDay}
      nextDayExercises={(nextDayExercises ?? []).map(e => e.name)}
      hasDays={dayKeys.length > 0}
      rotationSeq={seq}
      rotationIndex={rotation?.current_index ?? -1}
      lastTrainedByDay={lastTrainedByDay}
      firstName={firstName}
      completedAt={demoMode ? demoCompletedLocalDates() : completedLocalDates}
      totalPRs={demoMode ? DEMO_TOTAL_PRS : (totalPRs ?? 0)}
    />
  )
}
