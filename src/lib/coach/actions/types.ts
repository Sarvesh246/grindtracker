/**
 * Shared types for Coach confirm-before-apply actions.
 */

export type CoachActionKind =
  | 'correct_weights'
  | 'start_workout'
  | 'create_day'

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
