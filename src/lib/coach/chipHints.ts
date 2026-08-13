import type { SupabaseClient } from '@supabase/supabase-js'
import type { UserRotation } from '@/lib/types'
import { effectiveSequence, nextDay } from '@/lib/utils/rotation'
import type { CoachChipHints } from './starterChips'

/**
 * Lightweight hints for empty-state starter chips (not full USER_DATA).
 * Used by GET /api/coach/chat so the sheet can prefer next-day / last-PR
 * chips without waiting on a chat turn.
 */
export async function loadCoachChipHints(
  supabase: SupabaseClient,
  userId: string,
): Promise<CoachChipHints> {
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
    supabase.from('exercises').select('day_type').eq('user_id', userId),
    supabase
      .from('user_rotation')
      .select('mode, sequence, current_index')
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

  const dayKeys = Array.from(
    new Set(
      ((exerciseRows ?? []) as { day_type: string }[]).map(r => r.day_type),
    ),
  ).sort()
  const flexSet = new Set(
    ((flexRows ?? []) as { day_key: string }[]).map(r => r.day_key),
  )
  const rotation = (rotationRow as UserRotation | null) ?? null
  const seq = effectiveSequence(rotation, dayKeys, flexSet)
  const upNext = nextDay(seq, rotation?.current_index ?? -1)

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
  }
}
