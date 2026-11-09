/**
 * The finish sequence shared by ActiveWorkout.handleFinish, the Home
 * quick-save and the Log day-picker quick-save: complete the session on the
 * server, advance the rotation, write the undo token and award badges.
 *
 * UI-only work (modals, toasts, the client-side PR-list fallback,
 * `reconcileSessionExtras`) stays with the callers.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CompleteSessionResult, UserStats } from '@/lib/types'
import { localDateKey } from '@/lib/utils/formatting'
import { checkAndAwardBadges } from '@/lib/utils/badges'
import { writeFinishUndoToken } from '@/lib/utils/finishUndo'
import { isTransientError } from '@/lib/utils/offlineQueue'
import { advanceRotationAfterFinish, type PointerSnapshot } from '@/lib/utils/rotationStore'

export type PrExercise = { name: string; weight: number; reps: number }

export type CompleteSessionOutcome =
  | {
      ok: true
      result: CompleteSessionResult
      prExercises: PrExercise[]
      newBadges: string[]
    }
  | { ok: false; reason: 'no_working_sets' | 'failed'; error: unknown }

const ATTEMPTS = 3

function errorMessage(error: unknown): string {
  return String((error as { message?: string } | null)?.message ?? '')
}

export async function completeSession(
  supabase: SupabaseClient,
  args: {
    userId: string
    sessionId: string
    dayType: string
    note: string | null
    startHour: number
  },
): Promise<CompleteSessionOutcome> {
  const { userId, sessionId, dayType, note, startHour } = args

  // Completion is a single server-side transaction: xp, level, streak and PR
  // flags are all derived in Postgres (docs/sql/11-server-side-xp.sql). We send
  // only the local calendar date because streaks depend on the user's timezone.
  // Retries are for transient failures only — a refusal won't change.
  let finishData: unknown = null
  let finishError: unknown = null
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      const res = await supabase.rpc('complete_session', {
        p_session_id: sessionId,
        p_local_date: localDateKey(new Date()),
        p_note: note,
        p_start_hour: startHour,
      })
      finishData = res.data
      finishError = res.error
    } catch (err) {
      finishData = null
      finishError = err
    }
    if (!finishError && finishData) break
    // A lost response leaves the session completed server-side, so the next
    // attempt is refused with SESSION_NOT_OPEN — handled below as success.
    if (errorMessage(finishError).includes('SESSION_NOT_OPEN')) break
    if (!isTransientError(finishError)) break
    if (attempt < ATTEMPTS - 1) {
      await new Promise(resolve => setTimeout(resolve, 400 * 2 ** attempt))
    }
  }

  let result: CompleteSessionResult
  if (finishError || !finishData) {
    // The RPC is not naturally idempotent across a lost response: if the first
    // attempt committed server-side but the reply never arrived, the retry gets
    // SESSION_NOT_OPEN (the session is already completed). That specific error
    // means success, not failure — re-read what the server already settled on.
    const alreadyDone = errorMessage(finishError).includes('SESSION_NOT_OPEN')

    if (!alreadyDone) {
      console.error('[grind] complete_session failed', finishError, finishData)
      if (errorMessage(finishError).includes('NO_WORKING_SETS')) {
        return { ok: false, reason: 'no_working_sets', error: finishError }
      }
      return { ok: false, reason: 'failed', error: finishError ?? new Error('Finish failed') }
    }

    const [{ data: sessionRow }, { data: statsRow }, { data: prRows }] = await Promise.all([
      supabase.from('sessions').select('xp_earned').eq('id', sessionId).maybeSingle(),
      supabase.from('user_stats').select('*').eq('user_id', userId).maybeSingle(),
      // The RPC already flagged is_pr on session_logs server-side before its
      // response was lost — re-read it directly instead of reporting 0 PRs
      // for a completion that genuinely earned some.
      supabase
        .from('session_logs')
        .select('exercise_id, weight, reps, exercises(name)')
        .eq('session_id', sessionId)
        .eq('is_pr', true),
    ])
    if (!sessionRow || !statsRow) {
      return { ok: false, reason: 'failed', error: finishError ?? new Error('Finish failed') }
    }

    type PrLogRow = {
      exercise_id: string
      weight: number | null
      reps: number | null
      exercises: { name: string } | { name: string }[] | null
    }
    // List EVERY PR set (not one-per-exercise) so the modal matches pr_count.
    const recoveredPrs: PrExercise[] = []
    for (const row of (prRows ?? []) as PrLogRow[]) {
      if (row.weight === null || row.reps === null) continue
      const name = Array.isArray(row.exercises) ? row.exercises[0]?.name : row.exercises?.name
      recoveredPrs.push({ name: name || 'Exercise', weight: row.weight, reps: row.reps })
    }
    recoveredPrs.sort((a, b) => b.weight * b.reps - a.weight * a.reps)

    result = {
      xp_earned: sessionRow.xp_earned,
      xp_total: statsRow.xp_total,
      prev_level: statsRow.level,
      level: statsRow.level,
      // Can't recover whether THIS completion leveled the user up once the
      // original response is lost; under-reporting a level-up banner is a
      // harmless cosmetic miss, unlike mis-reporting XP.
      leveled_up: false,
      current_streak: statsRow.current_streak,
      longest_streak: statsRow.longest_streak,
      last_workout_date: statsRow.last_workout_date,
      total_workouts: statsRow.total_workouts,
      pr_count: recoveredPrs.length,
      pr_exercises: recoveredPrs,
    }
  } else {
    result = finishData as CompleteSessionResult
  }

  // Authoritative post-completion stats, for the badge check below.
  const updatedStats = {
    xp_total: result.xp_total,
    level: result.level,
    current_streak: result.current_streak,
    longest_streak: result.longest_streak,
    last_workout_date: result.last_workout_date,
    total_workouts: result.total_workouts,
    updated_at: new Date().toISOString(),
  }

  // Advance the rotation pointer so Home suggests the next day. Best-effort —
  // a failure here must never block completion. null (not -1) means "never
  // actually advanced" — see FinishUndoToken.
  let prevPointer: PointerSnapshot | null = null
  try {
    prevPointer = await advanceRotationAfterFinish(supabase, userId, dayType, sessionId)
  } catch {
    // Rotation is a non-critical convenience; swallow and move on.
  }

  writeFinishUndoToken({
    sessionId,
    day: dayType,
    userId,
    xpEarned: result.xp_earned ?? 0,
    prevRotationIndex: prevPointer?.index ?? null,
    prevRotationDay: prevPointer?.day ?? null,
  })

  // Badge awards are a bonus — never fail an already-saved finish over them.
  let newBadges: string[] = []
  try {
    newBadges = await checkAndAwardBadges(supabase, userId, {
      user_id: userId,
      ...updatedStats,
    } as UserStats)
  } catch {
    newBadges = []
  }

  return { ok: true, result, prExercises: result.pr_exercises ?? [], newBadges }
}
