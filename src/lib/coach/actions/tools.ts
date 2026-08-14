import { tool } from 'ai'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { LBS_PER_KG } from '@/lib/utils/units'
import { previewCorrectWeights } from './correctWeights'
import { previewCreateDay } from './createDay'
import { previewStartWorkout } from './startWorkout'
import type { CoachProposalView } from './types'

export type CoachToolContext = {
  supabase: SupabaseClient
  userId: string
  conversationId: string | null
  /** Display unit preference for weight inputs from the model. */
  unit: 'lb' | 'kg'
  /** Collect proposals created during this turn for the NDJSON stream. */
  proposals: CoachProposalView[]
}

/**
 * Preview-only tools. Mutations happen only after the user confirms via
 * POST /api/coach/actions.
 */
export function buildCoachProposalTools(ctx: CoachToolContext) {
  return {
    propose_correct_weights: tool({
      description:
        'Propose correcting past logged set weights for one exercise (e.g. bar was 25 not 20 so logged 90 should be 95). Preview only — user must Confirm in the UI before anything is written.',
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
          note: 'Waiting for user Confirm in the Coach UI. Do not claim the change is applied yet.',
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
        const toLbs = (v: number) =>
          ctx.unit === 'kg' ? v * LBS_PER_KG : v
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
  }
}
