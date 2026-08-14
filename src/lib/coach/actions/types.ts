/**
 * Shared types for Coach confirm-before-apply actions.
 */

import type { NotificationPrefsPatch } from '@/lib/push/validatePrefs'

export type { NotificationPrefsPatch } from '@/lib/push/validatePrefs'

export type CoachActionKind =
  | 'correct_weights'
  | 'start_workout'
  | 'create_day'
  | 'log_body_weight'
  | 'delete_body_weight'
  | 'finish_workout'
  | 'undo_finish_workout'
  | 'skip_sets'
  | 'toggle_rest_today'
  | 'set_rest_weekday'
  | 'edit_exercise'
  | 'update_rotation'
  | 'edit_session_log'
  | 'update_notification_prefs'

export type CoachActionStatus =
  | 'pending'
  | 'confirmed'
  | 'cancelled'
  | 'executed'
  | 'failed'

export type CoachActionCardModel = {
  title: string
  summaryLines: string[]
  riskNote?: string | null
  /** Step labels for longer multi-session work (shown during execute). */
  steps?: string[]
}

export type CoachPastLogRow = {
  exercise_id: string
  set_number: number
  weight: number
  reps: number
  is_warmup?: boolean
  note?: string | null
}

/** Full session_logs row shape for upsert_past_session (incl. skips + RPE). */
export type CoachSessionLogRow = {
  exercise_id: string
  set_number: number
  weight: number | null
  reps: number | null
  is_warmup: boolean
  is_skipped: boolean
  note: string | null
  rpe: number | null
}

export type CorrectWeightsExecutePayload = {
  exerciseName: string
  exerciseId: string | null
  fromWeightLbs: number
  toWeightLbs: number
  unitLabel: 'lb' | 'kg'
  sessions: {
    sessionId: string
    dayType: string
    localDate: string
    matchedSets: number
    logs: CoachPastLogRow[]
  }[]
}

export type StartWorkoutExecutePayload = {
  dayType: string
  resolvedFrom: 'explicit' | 'next_day'
}

export type CreateDayExerciseInput = {
  name: string
  sets_target: number
  reps_target: string
  weight_target_lbs?: number | null
}

export type CreateDayExecutePayload = {
  dayKey: string
  category: 'push' | 'pull' | 'legs' | 'other' | null
  exercises: CreateDayExerciseInput[]
}

export type LogBodyWeightExecutePayload = {
  weightLbs: number
  recordedAt: string
  unitLabel: 'lb' | 'kg'
  overwritten: boolean
}

export type DeleteBodyWeightExecutePayload = {
  recordedAt: string
  previousWeightLbs: number | null
}

export type FinishWorkoutExecutePayload = {
  sessionId: string
  dayType: string
  note: string | null
  localDate: string
  startHour: number | null
}

export type UndoFinishWorkoutExecutePayload = {
  sessionId: string
  dayType: string
  localDate: string | null
  prevRotationIndex: number | null
}

export type SkipSetsExecutePayload = {
  sessionId: string
  exerciseId: string
  exerciseName: string
  setNumbers: number[]
  skip: boolean
  scope: 'sets' | 'exercise'
}

export type ToggleRestTodayExecutePayload = {
  localDate: string
  /** True when Confirm will mark today as rest; false when it undoes a one-off. */
  turningOn: boolean
}

export type SetRestWeekdayExecutePayload = {
  dayOfWeek: number
  enabled: boolean
  localDate: string
  /** True when the weekday being enabled is the user's local today. */
  isTodayWeekday: boolean
}

export type EditExercisePatch = {
  sets_target?: number
  reps_target?: string
  weight_target_lbs?: number | null
  active?: boolean
}

export type EditExerciseExecutePayload = {
  exerciseId: string
  exerciseName: string
  dayType: string
  patch: EditExercisePatch
}

export type UpdateRotationExecutePayload = {
  mode: 'auto' | 'manual'
  sequence: string[]
  currentIndex: number
  resultingOrder: string[]
}

export type EditSessionLogExecutePayload = {
  sessionId: string
  dayType: string
  localDate: string
  exerciseName: string
  setNumber: number
  logs: CoachSessionLogRow[]
}

export type UpdateNotificationPrefsExecutePayload = {
  patch: NotificationPrefsPatch
}

export type CoachActionPayload =
  | {
      kind: 'correct_weights'
      card: CoachActionCardModel
      execute: CorrectWeightsExecutePayload
    }
  | {
      kind: 'start_workout'
      card: CoachActionCardModel
      execute: StartWorkoutExecutePayload
    }
  | {
      kind: 'create_day'
      card: CoachActionCardModel
      execute: CreateDayExecutePayload
    }
  | {
      kind: 'log_body_weight'
      card: CoachActionCardModel
      execute: LogBodyWeightExecutePayload
    }
  | {
      kind: 'delete_body_weight'
      card: CoachActionCardModel
      execute: DeleteBodyWeightExecutePayload
    }
  | {
      kind: 'finish_workout'
      card: CoachActionCardModel
      execute: FinishWorkoutExecutePayload
    }
  | {
      kind: 'undo_finish_workout'
      card: CoachActionCardModel
      execute: UndoFinishWorkoutExecutePayload
    }
  | {
      kind: 'skip_sets'
      card: CoachActionCardModel
      execute: SkipSetsExecutePayload
    }
  | {
      kind: 'toggle_rest_today'
      card: CoachActionCardModel
      execute: ToggleRestTodayExecutePayload
    }
  | {
      kind: 'set_rest_weekday'
      card: CoachActionCardModel
      execute: SetRestWeekdayExecutePayload
    }
  | {
      kind: 'edit_exercise'
      card: CoachActionCardModel
      execute: EditExerciseExecutePayload
    }
  | {
      kind: 'update_rotation'
      card: CoachActionCardModel
      execute: UpdateRotationExecutePayload
    }
  | {
      kind: 'edit_session_log'
      card: CoachActionCardModel
      execute: EditSessionLogExecutePayload
    }
  | {
      kind: 'update_notification_prefs'
      card: CoachActionCardModel
      execute: UpdateNotificationPrefsExecutePayload
    }

/** Client-facing proposal attached to an assistant message. */
export type CoachProposalView = {
  id: string
  kind: CoachActionKind
  status: CoachActionStatus
  card: CoachActionCardModel
  expiresAt: string
}

export type CoachActionProgressStep = {
  index: number
  total: number
  label: string
  state: 'pending' | 'active' | 'done' | 'error'
}

export type CoachActionRunState = {
  proposalId: string
  steps: CoachActionProgressStep[]
  phase: 'running' | 'done' | 'error'
  message?: string
}

export type CoachActionExecuteResult = {
  ok: boolean
  message: string
  /** For start_workout — client navigates here after success. */
  href?: string
  details?: Record<string, unknown>
}

export const COACH_PROPOSAL_TTL_MS = 30 * 60 * 1000

export const COACH_PROPOSAL_INSERT_FAILED =
  'Could not save the proposal. Apply docs/sql/36-coach-actions.sql (and 47-coach-action-kinds.sql) if you have not yet.'
