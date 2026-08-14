import type { SupabaseClient } from '@supabase/supabase-js'
import { executeCorrectWeights, formatCorrectWeightsMessage } from './correctWeights'
import { executeCreateDay } from './createDay'
import { executeStartWorkout } from './startWorkout'
import { executeLogBodyWeight } from './logBodyWeight'
import { executeDeleteBodyWeight } from './deleteBodyWeight'
import { executeFinishWorkout } from './finishWorkout'
import { executeUndoFinishWorkout } from './undoFinishWorkout'
import { executeSkipSets } from './skipSets'
import { executeToggleRestToday } from './toggleRestToday'
import { executeSetRestWeekday } from './setRestWeekday'
import { executeEditExercise } from './editExercise'
import { executeUpdateRotation } from './updateRotation'
import { executeEditSessionLog } from './editSessionLog'
import { executeUpdateNotificationPrefs } from './updateNotificationPrefs'
import { DOW_LABELS } from './dates'
import type { CoachActionPayload } from './types'

export type ConfirmedActionResult =
  | {
      ok: true
      message: string
      href?: string
      details: Record<string, unknown>
    }
  | { ok: false; message: string }

/**
 * Exhaustive kind dispatch. A missed/mistyped kind must fail loudly rather
 * than falling through to the wrong mutation (the old bare `else` assumed
 * create_day).
 */
export async function executeConfirmedPayload(
  supabase: SupabaseClient,
  userId: string,
  payload: CoachActionPayload,
): Promise<ConfirmedActionResult> {
  switch (payload.kind) {
    case 'correct_weights': {
      const result = await executeCorrectWeights(supabase, payload.execute)
      if (!result.ok) return { ok: false, message: result.message }
      return {
        ok: true,
        message: formatCorrectWeightsMessage(result.updated, result.failed),
        details: { updated: result.updated, failed: result.failed },
      }
    }
    case 'start_workout': {
      const result = await executeStartWorkout(supabase, payload.execute.dayType)
      if (!result.ok) return { ok: false, message: result.message }
      return {
        ok: true,
        message: result.resumed
          ? `Resuming ${payload.execute.dayType}.`
          : `Starting ${payload.execute.dayType}.`,
        href: result.href,
        details: { resumed: result.resumed, dayType: payload.execute.dayType },
      }
    }
    case 'create_day': {
      const result = await executeCreateDay(supabase, {
        userId,
        dayKey: payload.execute.dayKey,
        category: payload.execute.category,
        exercises: payload.execute.exercises,
      })
      if (!result.ok) return { ok: false, message: result.message }
      return {
        ok: true,
        message: `Created “${payload.execute.dayKey}” with ${result.inserted} exercise${result.inserted === 1 ? '' : 's'}. Pick it from Log when you want to train — it won’t start automatically.`,
        href: '/log',
        details: {
          inserted: result.inserted,
          dayKey: payload.execute.dayKey,
        },
      }
    }
    case 'log_body_weight': {
      const result = await executeLogBodyWeight(supabase, {
        userId,
        weightLbs: payload.execute.weightLbs,
        recordedAt: payload.execute.recordedAt,
      })
      if (!result.ok) return { ok: false, message: result.message }
      return {
        ok: true,
        message: payload.execute.overwritten
          ? `Updated body weight for ${payload.execute.recordedAt}.`
          : `Logged body weight for ${payload.execute.recordedAt}.`,
        details: { recordedAt: payload.execute.recordedAt },
      }
    }
    case 'delete_body_weight': {
      const result = await executeDeleteBodyWeight(supabase, {
        userId,
        recordedAt: payload.execute.recordedAt,
      })
      if (!result.ok) return { ok: false, message: result.message }
      return {
        ok: true,
        message: `Deleted body weight for ${payload.execute.recordedAt}.`,
        details: { recordedAt: payload.execute.recordedAt },
      }
    }
    case 'finish_workout': {
      const result = await executeFinishWorkout(supabase, {
        userId,
        sessionId: payload.execute.sessionId,
        dayType: payload.execute.dayType,
        note: payload.execute.note,
        localDate: payload.execute.localDate,
        startHour: payload.execute.startHour,
      })
      if (!result.ok) return { ok: false, message: result.message }
      return {
        ok: true,
        message: `Finished ${payload.execute.dayType}.`,
        href: '/home',
        details: { dayType: payload.execute.dayType },
      }
    }
    case 'undo_finish_workout': {
      const result = await executeUndoFinishWorkout(supabase, {
        userId,
        sessionId: payload.execute.sessionId,
        localDate: payload.execute.localDate,
        prevRotationIndex: payload.execute.prevRotationIndex,
      })
      if (!result.ok) return { ok: false, message: result.message }
      return {
        ok: true,
        message: `Reopened ${payload.execute.dayType}.`,
        href: `/log?day=${encodeURIComponent(payload.execute.dayType)}`,
        details: { dayType: payload.execute.dayType },
      }
    }
    case 'skip_sets': {
      const result = await executeSkipSets(supabase, payload.execute)
      if (!result.ok) return { ok: false, message: result.message }
      const verb = payload.execute.skip ? 'Skipped' : 'Unskipped'
      return {
        ok: true,
        message: `${verb} ${payload.execute.exerciseName} (${result.count} set${result.count === 1 ? '' : 's'}).`,
        details: { count: result.count },
      }
    }
    case 'toggle_rest_today': {
      const result = await executeToggleRestToday(
        supabase,
        payload.execute.localDate,
      )
      if (!result.ok) return { ok: false, message: result.message }
      return {
        ok: true,
        message: result.undone
          ? 'Rest today undone.'
          : result.rest
            ? 'Marked today as rest.'
            : 'Rest day updated.',
        details: { rest: result.rest, undone: result.undone },
      }
    }
    case 'set_rest_weekday': {
      const result = await executeSetRestWeekday(supabase, {
        dayOfWeek: payload.execute.dayOfWeek,
        enabled: payload.execute.enabled,
        localDate: payload.execute.localDate,
      })
      if (!result.ok) return { ok: false, message: result.message }
      const label = DOW_LABELS[payload.execute.dayOfWeek] ?? 'that day'
      return {
        ok: true,
        message: payload.execute.enabled
          ? `Rest every ${label} saved.`
          : `${label} rest removed.`,
        details: {
          dayOfWeek: payload.execute.dayOfWeek,
          enabled: payload.execute.enabled,
        },
      }
    }
    case 'edit_exercise': {
      const result = await executeEditExercise(supabase, {
        userId,
        exerciseId: payload.execute.exerciseId,
        patch: payload.execute.patch,
      })
      if (!result.ok) return { ok: false, message: result.message }
      return {
        ok: true,
        message: `Updated ${payload.execute.exerciseName}.`,
        details: { exerciseId: payload.execute.exerciseId },
      }
    }
    case 'update_rotation': {
      const result = await executeUpdateRotation(supabase, {
        userId,
        mode: payload.execute.mode,
        sequence: payload.execute.sequence,
        currentIndex: payload.execute.currentIndex,
      })
      if (!result.ok) return { ok: false, message: result.message }
      return {
        ok: true,
        message: `Workout order saved: ${payload.execute.resultingOrder.join(' → ')}.`,
        details: { order: payload.execute.resultingOrder },
      }
    }
    case 'edit_session_log': {
      const result = await executeEditSessionLog(supabase, payload.execute)
      if (!result.ok) return { ok: false, message: result.message }
      return {
        ok: true,
        message: `Updated ${payload.execute.exerciseName} set ${payload.execute.setNumber} on ${payload.execute.localDate}.`,
        details: {
          sessionId: payload.execute.sessionId,
          setNumber: payload.execute.setNumber,
        },
      }
    }
    case 'update_notification_prefs': {
      const result = await executeUpdateNotificationPrefs(supabase, {
        userId,
        patch: payload.execute.patch,
      })
      if (!result.ok) return { ok: false, message: result.message }
      return {
        ok: true,
        message: 'Notification preferences saved.',
        details: { patch: payload.execute.patch },
      }
    }
    default: {
      const _never: never = payload
      return {
        ok: false,
        message: `Unknown action kind: ${String((_never as CoachActionPayload).kind)}`,
      }
    }
  }
}
