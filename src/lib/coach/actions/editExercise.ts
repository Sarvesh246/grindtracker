import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveExerciseByName } from './resolveExercise'
import { insertCoachProposal, fmtWeightForUnit } from './proposals'
import { COACH_PROPOSAL_INSERT_FAILED } from './types'
import type {
  CoachActionPayload,
  CoachProposalView,
  EditExercisePatch,
} from './types'

export function validateEditExerciseInput(input: {
  exerciseName: string
  dayType: string
  sets_target?: number | null
  reps_target?: string | null
  weight_target_lbs?: number | null
  active?: boolean | null
}):
  | {
      ok: true
      exerciseName: string
      dayType: string
      patch: EditExercisePatch
    }
  | { ok: false; reason: string } {
  const exerciseName = String(input.exerciseName ?? '').trim()
  if (!exerciseName) {
    return { ok: false, reason: 'Exercise name is required.' }
  }
  const dayType = String(input.dayType ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
  if (!dayType) {
    return { ok: false, reason: 'Day name is required.' }
  }

  const patch: EditExercisePatch = {}
  if (input.sets_target != null) {
    const sets = Math.round(Number(input.sets_target))
    if (!Number.isFinite(sets) || sets < 1 || sets > 20) {
      return { ok: false, reason: 'Sets must be between 1 and 20.' }
    }
    patch.sets_target = sets
  }
  if (input.reps_target != null) {
    const reps = String(input.reps_target).trim()
    if (!reps) {
      return { ok: false, reason: 'Reps target cannot be empty.' }
    }
    patch.reps_target = reps.slice(0, 24)
  }
  if (input.weight_target_lbs !== undefined) {
    if (input.weight_target_lbs === null) {
      patch.weight_target_lbs = null
    } else {
      const w = Number(input.weight_target_lbs)
      if (!Number.isFinite(w) || w < 0) {
        return { ok: false, reason: 'Target weight must be a positive number.' }
      }
      patch.weight_target_lbs = w
    }
  }
  if (input.active != null) {
    patch.active = Boolean(input.active)
  }

  if (Object.keys(patch).length === 0) {
    return {
      ok: false,
      reason: 'Provide at least one change (sets, reps, target weight, or active).',
    }
  }

  return { ok: true, exerciseName, dayType, patch }
}

export async function previewEditExercise(
  supabase: SupabaseClient,
  args: {
    userId: string
    conversationId: string | null
    exerciseName: string
    dayType: string
    sets_target?: number | null
    reps_target?: string | null
    weight_target_lbs?: number | null
    active?: boolean | null
    unit: 'lb' | 'kg'
  },
): Promise<
  | { ok: true; proposal: CoachProposalView }
  | { ok: false; reason: string }
> {
  const validated = validateEditExerciseInput(args)
  if (!validated.ok) return validated

  const resolved = await resolveExerciseByName(
    supabase,
    args.userId,
    validated.exerciseName,
    { dayType: validated.dayType },
  )
  if (!resolved.ok) return resolved
  const ex = resolved.exercise
  const unitLabel = args.unit === 'kg' ? 'kg' : 'lb'

  const lines: string[] = [`${ex.name} · ${ex.day_type}`]
  const p = validated.patch
  if (p.sets_target != null) {
    lines.push(`Sets: ${ex.sets_target} → ${p.sets_target}`)
  }
  if (p.reps_target != null) {
    lines.push(`Reps: ${ex.reps_target} → ${p.reps_target}`)
  }
  if (p.weight_target_lbs !== undefined) {
    const from =
      ex.weight_target != null
        ? fmtWeightForUnit(Number(ex.weight_target), unitLabel)
        : 'none'
    const to =
      p.weight_target_lbs != null
        ? fmtWeightForUnit(p.weight_target_lbs, unitLabel)
        : 'none'
    lines.push(`Target weight: ${from} → ${to}`)
  }
  if (p.active != null) {
    lines.push(p.active ? 'Show in Log picker' : 'Hide from Log picker')
  }

  const payload: CoachActionPayload = {
    kind: 'edit_exercise',
    card: {
      title: 'Edit exercise',
      summaryLines: lines,
      riskNote:
        p.active === false
          ? 'Stays in your history, just hidden from today’s Log picker.'
          : 'Updates targets for future sessions. Past logs are unchanged.',
    },
    execute: {
      exerciseId: ex.id,
      exerciseName: ex.name,
      dayType: ex.day_type,
      patch: p,
    },
  }

  const proposal = await insertCoachProposal(supabase, {
    userId: args.userId,
    conversationId: args.conversationId,
    payload,
  })
  if (!proposal) {
    return { ok: false, reason: COACH_PROPOSAL_INSERT_FAILED }
  }
  return { ok: true, proposal }
}

export async function executeEditExercise(
  supabase: SupabaseClient,
  args: { userId: string; exerciseId: string; patch: EditExercisePatch },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const update: Record<string, unknown> = {}
  if (args.patch.sets_target != null) update.sets_target = args.patch.sets_target
  if (args.patch.reps_target != null) update.reps_target = args.patch.reps_target
  if (args.patch.weight_target_lbs !== undefined) {
    update.weight_target = args.patch.weight_target_lbs
  }
  if (args.patch.active != null) update.active = args.patch.active

  const { data, error } = await supabase
    .from('exercises')
    .update(update)
    .eq('id', args.exerciseId)
    .eq('user_id', args.userId)
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, message: error.message }
  if (!data) return { ok: false, message: 'Exercise not found.' }
  return { ok: true }
}
