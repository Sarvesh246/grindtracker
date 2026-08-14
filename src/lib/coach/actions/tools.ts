import { tool } from 'ai'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { LBS_PER_KG } from '@/lib/utils/units'
import { previewCorrectWeights } from './correctWeights'
import { previewCreateDay } from './createDay'
import { previewStartWorkout } from './startWorkout'
import { previewLogBodyWeight } from './logBodyWeight'
import { previewDeleteBodyWeight } from './deleteBodyWeight'
import { previewFinishWorkout } from './finishWorkout'
import { previewUndoFinishWorkout } from './undoFinishWorkout'
import { previewSkipSets } from './skipSets'
import { previewToggleRestToday } from './toggleRestToday'
import { previewSetRestWeekday } from './setRestWeekday'
import { previewEditExercise } from './editExercise'
import { previewUpdateRotation } from './updateRotation'
import { displayWeightToLbs, previewEditSessionLog } from './editSessionLog'
import { previewUpdateNotificationPrefs } from './updateNotificationPrefs'
import type { CoachProposalView } from './types'

export type CoachToolContext = {
  supabase: SupabaseClient
  userId: string
  conversationId: string | null
  /** Display unit preference for weight inputs from the model. */
  unit: 'lb' | 'kg'
  /** User's local calendar day (YYYY-MM-DD) from the client. */
  localDate: string
  timeZone: string | null
  /** Collect proposals created during this turn for the NDJSON stream. */
  proposals: CoachProposalView[]
}

const CONFIRM_NOTE =
  'Waiting for user Confirm in the Coach UI. Do not claim the change is applied yet.'

/**
 * Preview-only tools. Mutations happen only after the user confirms via
 * POST /api/coach/actions.
 */
export function buildCoachProposalTools(ctx: CoachToolContext) {
  const toLbs = (v: number) => (ctx.unit === 'kg' ? v * LBS_PER_KG : v)

  return {
    propose_correct_weights: tool({
      description:
        'Propose correcting the SAME wrong weight on one exercise across MULTIPLE past completed sessions (e.g. bar was 25 not 20 so every logged 90 should be 95). Not for a single set’s reps/RPE/note — use propose_edit_session_log for that. Preview only — user must Confirm in the UI before anything is written.',
      inputSchema: z.object({
        exerciseName: z
          .string()
          .min(1)
          .describe('Exercise name as the user knows it, e.g. "Bench Press"'),
        fromWeight: z
          .number()
          .positive()
          .describe('Incorrect weight currently logged (in the user unit)'),
        toWeight: z
          .number()
          .positive()
          .describe('Correct weight to apply (same unit)'),
        unit: z
          .enum(['lb', 'kg'])
          .optional()
          .describe('Unit for fromWeight/toWeight; defaults to user preference'),
      }),
      execute: async input => {
        const unit = input.unit ?? ctx.unit
        const result = await previewCorrectWeights(ctx.supabase, {
          userId: ctx.userId,
          conversationId: ctx.conversationId,
          input: {
            exerciseName: input.exerciseName,
            fromWeight: input.fromWeight,
            toWeight: input.toWeight,
            unit,
          },
        })
        if (!result.ok) {
          return { ok: false as const, reason: result.reason }
        }
        ctx.proposals.push(result.proposal)
        return {
          ok: true as const,
          proposalId: result.proposal.id,
          summary: result.proposal.card.summaryLines.join(' · '),
          matchedSets: result.matchedSets,
          note: CONFIRM_NOTE,
        }
      },
    }),

    propose_start_workout: tool({
      description:
        'Propose starting (or resuming) a workout day. ONLY when the user explicitly asks to start/begin/train now (or after create_day, only if they separately ask to start it). Preview only — Confirm opens Active Workout. Do NOT call this just because you created a day.',
      inputSchema: z.object({
        dayType: z
          .string()
          .optional()
          .describe(
            'Day name to start. Omit to use the suggested next day from their rotation/schedule.',
          ),
      }),
      execute: async input => {
        const result = await previewStartWorkout(ctx.supabase, {
          userId: ctx.userId,
          conversationId: ctx.conversationId,
          dayType: input.dayType ?? null,
        })
        if (!result.ok) {
          return { ok: false as const, reason: result.reason }
        }
        ctx.proposals.push(result.proposal)
        return {
          ok: true as const,
          proposalId: result.proposal.id,
          summary: result.proposal.card.summaryLines.join(' · '),
          note: 'Waiting for user Confirm. Do not claim the workout has started yet.',
        }
      },
    }),

    propose_create_day: tool({
      description:
        'Propose creating a new workout day in the user catalog from a planned exercise list. Preview only — Confirm inserts exercises and opens the Log day picker. Does NOT start a session. Never also call propose_start_workout in the same turn unless the user explicitly asked to start training after creating the day.',
      inputSchema: z.object({
        dayKey: z.string().min(1).describe('New day name, e.g. "upper" or "push 2"'),
        category: z
          .enum(['push', 'pull', 'legs', 'other'])
          .optional()
          .describe('Leaderboard category when known'),
        exercises: z
          .array(
            z.object({
              name: z.string().min(1),
              sets_target: z.number().int().min(1).max(12),
              reps_target: z.string().min(1),
              weight_target_lbs: z
                .number()
                .positive()
                .optional()
                .describe(
                  'Optional target weight in the user display unit (lb or kg from preference)',
                ),
            }),
          )
          .min(1)
          .max(20),
      }),
      execute: async input => {
        const result = await previewCreateDay(ctx.supabase, {
          userId: ctx.userId,
          conversationId: ctx.conversationId,
          dayKey: input.dayKey,
          category: input.category ?? null,
          exercises: input.exercises.map(e => ({
            name: e.name,
            sets_target: e.sets_target,
            reps_target: e.reps_target,
            weight_target_lbs:
              e.weight_target_lbs != null ? toLbs(e.weight_target_lbs) : null,
          })),
        })
        if (!result.ok) {
          return { ok: false as const, reason: result.reason }
        }
        ctx.proposals.push(result.proposal)
        return {
          ok: true as const,
          proposalId: result.proposal.id,
          summary: result.proposal.card.summaryLines.join(' · '),
          note: 'Waiting for user Confirm. Do not claim the day exists yet.',
        }
      },
    }),

    propose_log_body_weight: tool({
      description:
        'Propose logging (or overwriting) a body-weight entry for a calendar date. Use when they say they weighed in, “log 180”, “I weigh 82 kg”, or want to correct today’s scale reading. Not for barbell/exercise weights (those are propose_correct_weights / propose_edit_session_log). Overwrites any existing entry that date.',
      inputSchema: z.object({
        weight: z.number().positive().describe('Body weight in the given unit'),
        unit: z.enum(['lb', 'kg']).optional(),
        date: z
          .string()
          .optional()
          .describe('YYYY-MM-DD; defaults to the user’s local today'),
      }),
      execute: async input => {
        const result = await previewLogBodyWeight(ctx.supabase, {
          userId: ctx.userId,
          conversationId: ctx.conversationId,
          weight: input.weight,
          unit: input.unit ?? ctx.unit,
          date: input.date ?? null,
          today: ctx.localDate,
        })
        if (!result.ok) return { ok: false as const, reason: result.reason }
        ctx.proposals.push(result.proposal)
        return {
          ok: true as const,
          proposalId: result.proposal.id,
          summary: result.proposal.card.summaryLines.join(' · '),
          note: CONFIRM_NOTE,
        }
      },
    }),

    propose_delete_body_weight: tool({
      description:
        'Propose deleting a body-weight log for one calendar date (e.g. “delete yesterday’s weigh-in”). Not for exercise set weights.',
      inputSchema: z.object({
        date: z.string().describe('YYYY-MM-DD of the entry to delete'),
      }),
      execute: async input => {
        const result = await previewDeleteBodyWeight(ctx.supabase, {
          userId: ctx.userId,
          conversationId: ctx.conversationId,
          date: input.date,
          unit: ctx.unit,
        })
        if (!result.ok) return { ok: false as const, reason: result.reason }
        ctx.proposals.push(result.proposal)
        return {
          ok: true as const,
          proposalId: result.proposal.id,
          summary: result.proposal.card.summaryLines.join(' · '),
          note: CONFIRM_NOTE,
        }
      },
    }),

    propose_finish_workout: tool({
      description:
        'Propose finishing the currently open workout (I’m done, finish this session, complete today’s lift). Requires ≥1 working set already logged. Do NOT use for past-date logging. Preview only.',
      inputSchema: z.object({
        note: z.string().optional().describe('Optional workout note to save on finish'),
      }),
      execute: async input => {
        const result = await previewFinishWorkout(ctx.supabase, {
          userId: ctx.userId,
          conversationId: ctx.conversationId,
          note: input.note ?? null,
          localDate: ctx.localDate,
          timeZone: ctx.timeZone,
        })
        if (!result.ok) return { ok: false as const, reason: result.reason }
        ctx.proposals.push(result.proposal)
        return {
          ok: true as const,
          proposalId: result.proposal.id,
          summary: result.proposal.card.summaryLines.join(' · '),
          note: CONFIRM_NOTE,
        }
      },
    }),

    propose_undo_finish_workout: tool({
      description:
        'Propose undoing a just-finished workout (I wasn’t done, undo that finish, reopen the session). Only works within the 10-minute undo window. Not for deleting workouts.',
      inputSchema: z.object({}),
      execute: async () => {
        const result = await previewUndoFinishWorkout(ctx.supabase, {
          userId: ctx.userId,
          conversationId: ctx.conversationId,
          localDate: ctx.localDate,
        })
        if (!result.ok) return { ok: false as const, reason: result.reason }
        ctx.proposals.push(result.proposal)
        return {
          ok: true as const,
          proposalId: result.proposal.id,
          summary: result.proposal.card.summaryLines.join(' · '),
          note: CONFIRM_NOTE,
        }
      },
    }),

    propose_skip_sets: tool({
      description:
        'Propose skipping or unskipping sets on the OPEN workout only. One tool for both: skip=true marks sets skipped (inert markers, not failures); skip=false removes those markers. scope=exercise skips/unskips the whole lift; scope=sets needs setNumbers. Examples: “skip the last set of bench”, “unskip squats”, “skip the rest of this exercise”. ok:false if no session is open.',
      inputSchema: z.object({
        exerciseName: z.string().min(1),
        scope: z.enum(['sets', 'exercise']),
        setNumbers: z
          .array(z.number().int().min(1).max(30))
          .optional()
          .describe('Required when scope is sets'),
        skip: z.boolean().describe('true = skip, false = unskip'),
      }),
      execute: async input => {
        const result = await previewSkipSets(ctx.supabase, {
          userId: ctx.userId,
          conversationId: ctx.conversationId,
          exerciseName: input.exerciseName,
          scope: input.scope,
          setNumbers: input.setNumbers ?? null,
          skip: input.skip,
        })
        if (!result.ok) return { ok: false as const, reason: result.reason }
        ctx.proposals.push(result.proposal)
        return {
          ok: true as const,
          proposalId: result.proposal.id,
          summary: result.proposal.card.summaryLines.join(' · '),
          note: CONFIRM_NOTE,
        }
      },
    }),

    propose_toggle_rest_today: tool({
      description:
        'Propose marking TODAY as a one-off rest day, or undoing that one-off. Use for “rest today”, “taking today off”, “undo rest today”. Not for weekly schedule (“always rest on Sunday” → propose_set_rest_weekday) and not for finishing a workout.',
      inputSchema: z.object({}),
      execute: async () => {
        const result = await previewToggleRestToday(ctx.supabase, {
          userId: ctx.userId,
          conversationId: ctx.conversationId,
          localDate: ctx.localDate,
        })
        if (!result.ok) return { ok: false as const, reason: result.reason }
        ctx.proposals.push(result.proposal)
        return {
          ok: true as const,
          proposalId: result.proposal.id,
          summary: result.proposal.card.summaryLines.join(' · '),
          note: CONFIRM_NOTE,
        }
      },
    }),

    propose_set_rest_weekday: tool({
      description:
        'Propose enabling or disabling a weekly rest weekday (always rest on Sunday, remove Wednesday rest). Newly enabling a weekday does NOT cover today — it starts on the next occurrence. For a one-off today, use propose_toggle_rest_today instead.',
      inputSchema: z.object({
        dayOfWeek: z
          .union([z.number().int().min(0).max(6), z.string()])
          .describe('0–6 (Sun–Sat) or a weekday name'),
        enabled: z.boolean(),
      }),
      execute: async input => {
        const result = await previewSetRestWeekday(ctx.supabase, {
          userId: ctx.userId,
          conversationId: ctx.conversationId,
          dayOfWeek: input.dayOfWeek,
          enabled: input.enabled,
          localDate: ctx.localDate,
        })
        if (!result.ok) return { ok: false as const, reason: result.reason }
        ctx.proposals.push(result.proposal)
        return {
          ok: true as const,
          proposalId: result.proposal.id,
          summary: result.proposal.card.summaryLines.join(' · '),
          note: CONFIRM_NOTE,
        }
      },
    }),

    propose_edit_exercise: tool({
      description:
        'Propose editing an exercise in the catalog: sets/reps/weight targets and/or hiding it (active=false). Examples: “bump bench to 4 sets”, “change squat reps to 5”, “hide curls from log”. Does NOT change already-logged sets (use propose_edit_session_log / propose_correct_weights). sets_target is 1–20.',
      inputSchema: z.object({
        exerciseName: z.string().min(1),
        dayType: z.string().min(1).describe('Day the exercise belongs to'),
        sets_target: z.number().int().min(1).max(20).optional(),
        reps_target: z.string().optional(),
        weight_target: z
          .number()
          .optional()
          .describe('Target weight in the user display unit; omit to leave unchanged'),
        active: z
          .boolean()
          .optional()
          .describe('false hides from Log picker but keeps history'),
      }),
      execute: async input => {
        const result = await previewEditExercise(ctx.supabase, {
          userId: ctx.userId,
          conversationId: ctx.conversationId,
          exerciseName: input.exerciseName,
          dayType: input.dayType,
          sets_target: input.sets_target ?? null,
          reps_target: input.reps_target ?? null,
          weight_target_lbs:
            input.weight_target !== undefined ? toLbs(input.weight_target) : undefined,
          active: input.active ?? null,
          unit: ctx.unit,
        })
        if (!result.ok) return { ok: false as const, reason: result.reason }
        ctx.proposals.push(result.proposal)
        return {
          ok: true as const,
          proposalId: result.proposal.id,
          summary: result.proposal.card.summaryLines.join(' · '),
          note: CONFIRM_NOTE,
        }
      },
    }),

    propose_update_rotation: tool({
      description:
        'Propose changing workout order / rotation. mode=auto rebuilds A–Z (flex days out). mode=manual requires the full sequence of day names in order (repeats allowed). Use when they want to reorder days, switch to manual order, or reset to auto. The confirm card lists the FULL resulting order.',
      inputSchema: z.object({
        mode: z.enum(['auto', 'manual']),
        sequence: z
          .array(z.string().min(1))
          .optional()
          .describe('Required for manual; ignored-as-order for auto'),
      }),
      execute: async input => {
        const result = await previewUpdateRotation(ctx.supabase, {
          userId: ctx.userId,
          conversationId: ctx.conversationId,
          mode: input.mode,
          sequence: input.sequence ?? null,
        })
        if (!result.ok) return { ok: false as const, reason: result.reason }
        ctx.proposals.push(result.proposal)
        return {
          ok: true as const,
          proposalId: result.proposal.id,
          summary: result.proposal.card.summaryLines.join(' · '),
          note: CONFIRM_NOTE,
        }
      },
    }),

    propose_edit_session_log: tool({
      description:
        'Propose editing ONE set in ONE completed session (reps, RPE, note, warm-up flag, and/or that set’s weight). Examples: “that squat set was actually 8 not 5”, “mark set 1 as warm-up”, “RPE was 9”. For the same wrong weight across many sessions use propose_correct_weights instead. Confirm rewrites the whole session’s logs but only the requested fields on the targeted set change.',
      inputSchema: z.object({
        dayType: z.string().min(1),
        localDate: z.string().describe('YYYY-MM-DD of the completed session'),
        exerciseName: z.string().min(1),
        setNumber: z.number().int().min(1),
        reps: z.number().int().min(0).max(500).optional(),
        weight: z.number().positive().optional().describe('In the user display unit'),
        unit: z.enum(['lb', 'kg']).optional(),
        rpe: z.number().int().min(1).max(10).nullable().optional(),
        note: z.string().nullable().optional(),
        isWarmup: z.boolean().optional(),
      }),
      execute: async input => {
        const unit = input.unit ?? ctx.unit
        const patch: {
          reps?: number
          weightLbs?: number
          rpe?: number | null
          note?: string | null
          isWarmup?: boolean
        } = {}
        if (input.reps !== undefined) patch.reps = input.reps
        if (input.weight !== undefined) {
          patch.weightLbs = displayWeightToLbs(input.weight, unit)
        }
        if (input.rpe !== undefined) patch.rpe = input.rpe
        if (input.note !== undefined) patch.note = input.note
        if (input.isWarmup !== undefined) patch.isWarmup = input.isWarmup

        const result = await previewEditSessionLog(ctx.supabase, {
          userId: ctx.userId,
          conversationId: ctx.conversationId,
          dayType: input.dayType,
          localDate: input.localDate,
          exerciseName: input.exerciseName,
          setNumber: input.setNumber,
          patch,
          unit,
        })
        if (!result.ok) return { ok: false as const, reason: result.reason }
        ctx.proposals.push(result.proposal)
        return {
          ok: true as const,
          proposalId: result.proposal.id,
          summary: result.proposal.card.summaryLines.join(' · '),
          note: CONFIRM_NOTE,
        }
      },
    }),

    propose_update_notification_prefs: tool({
      description:
        'Propose changing notification preferences (master enabled, rest-complete, 10s rest warning, workout status, streak reminder on/off, streak reminder hour 17–21, timezone). Examples: “turn off notifications”, “move my streak reminder from 7pm to 6pm”. Not for theme/units. Check USER_DATA.notifications first so you can describe the change.',
      inputSchema: z.object({
        enabled: z.boolean().optional(),
        rest_complete: z.boolean().optional(),
        rest_warning_10s: z.boolean().optional(),
        workout_status: z.boolean().optional(),
        streak_reminder: z.boolean().optional(),
        streak_reminder_hour: z.number().int().min(17).max(21).optional(),
        timezone: z.string().optional(),
      }),
      execute: async input => {
        const result = await previewUpdateNotificationPrefs(ctx.supabase, {
          userId: ctx.userId,
          conversationId: ctx.conversationId,
          body: input as Record<string, unknown>,
        })
        if (!result.ok) return { ok: false as const, reason: result.reason }
        ctx.proposals.push(result.proposal)
        return {
          ok: true as const,
          proposalId: result.proposal.id,
          summary: result.proposal.card.summaryLines.join(' · '),
          note: CONFIRM_NOTE,
        }
      },
    }),
  }
}
