import type { SupabaseClient } from '@supabase/supabase-js'
import { loadRotationState } from '@/lib/utils/rotationStore'
import { enabledDayKeys } from '@/lib/utils/dayKeys'
import type { UserRotation } from '@/lib/types'
import { effectiveSequence, nextDay } from '@/lib/utils/rotation'
import { getBodySummary } from '@/lib/body/queries'
import type { CoachChipHints } from './starterChips'
import { coachBodyEnabled } from './bodyContext'

/**
 * Lightweight hints for empty-state starter chips (not full USER_DATA).
 * Used by GET /api/coach/chat so the sheet can prefer next-day / last-PR
 * chips without waiting on a chat turn.
 */
export async function loadCoachChipHints(
  supabase: SupabaseClient,
  userId: string,
  /**
   * The user's local day (localDateKey() from the client). Without it there is
   * no Charge chip: the server's UTC day would read the wrong daily_body row.
   */
  opts?: { localDate?: string | null },
): Promise<CoachChipHints> {
  const localDate = opts?.localDate && /^\d{4}-\d{2}-\d{2}$/.test(opts.localDate) ? opts.localDate : null
  const chargePromise: Promise<number | null> = localDate
    ? getBodySummary(supabase, userId, localDate)
        .then(s => (coachBodyEnabled(s) ? (s.charge?.score ?? null) : null))
        .catch(() => null)
    : Promise.resolve(null)

  const [
    { data: active },
    { data: exerciseRows },
    { data: rotationRow },
    { data: flexRows },
    { data: prRow },
  ] = await Promise.all([
    supabase
      .from('sessions')
      .select('id')
      .eq('user_id', userId)
      .is('completed_at', null)
      .limit(1)
      .maybeSingle(),
    supabase.from('exercises').select('day_type, active').eq('user_id', userId),
    supabase
      .from('user_rotation')
      .select('mode, sequence, current_index, current_day, updated_at')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase.from('user_flex_days').select('day_key').eq('user_id', userId),
    supabase
      .from('session_logs')
      .select('exercises(name), sessions!inner(user_id, completed_at)')
      .eq('is_pr', true)
      .eq('sessions.user_id', userId)
      .not('sessions.completed_at', 'is', null)
      .not('weight', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const dayKeys = enabledDayKeys(
    (exerciseRows ?? []) as { day_type: string; active?: boolean }[],
  ).sort()
  const flexSet = new Set(
    ((flexRows ?? []) as { day_key: string }[]).map(r => r.day_key),
  )
  const rotation = (rotationRow as UserRotation | null) ?? null
  const seq = effectiveSequence(rotation, dayKeys, flexSet)
  // Same resolver as Home's Start button; raw pointer only if that read fails.
  const upNext = await loadRotationState(supabase, userId)
    .then(s => s.nextDay)
    .catch(() => nextDay(seq, rotation?.current_index ?? -1))

  let lastPrExercise: string | null = null
  if (prRow) {
    const ex = (
      prRow as {
        exercises: { name: string } | { name: string }[] | null
      }
    ).exercises
    if (Array.isArray(ex)) lastPrExercise = ex[0]?.name ?? null
    else lastPrExercise = ex?.name ?? null
  }

  return {
    hasActiveSession: !!active,
    nextDay: upNext,
    lastPrExercise,
    chargeScore: await chargePromise,
  }
}
