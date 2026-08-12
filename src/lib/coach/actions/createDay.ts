import type { SupabaseClient } from '@supabase/supabase-js'
import { insertCoachProposal } from './proposals'
import type {
  CoachActionPayload,
  CoachProposalView,
  CreateDayExerciseInput,
} from './types'

const CATEGORIES = new Set(['push', 'pull', 'legs', 'other'])

function normalizeDayKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function validateCreateDayInput(input: {
  dayKey: string
  category?: string | null
  exercises: CreateDayExerciseInput[]
}):
  | {
      ok: true
      dayKey: string
      category: 'push' | 'pull' | 'legs' | 'other' | null
      exercises: CreateDayExerciseInput[]
    }
  | { ok: false; reason: string } {
  const dayKey = normalizeDayKey(input.dayKey)
  if (!dayKey || dayKey.length > 40) {
    return { ok: false, reason: 'Day name is required (max 40 characters).' }
  }
  if (!/^[a-z0-9][a-z0-9 \-_]*$/i.test(dayKey)) {
    return {
      ok: false,
      reason: 'Day name may only use letters, numbers, spaces, hyphens, or underscores.',
    }
  }

  let category: 'push' | 'pull' | 'legs' | 'other' | null = null
  if (input.category) {
    const c = String(input.category).trim().toLowerCase()
    if (!CATEGORIES.has(c)) {
      return {
        ok: false,
        reason: 'Category must be push, pull, legs, or other.',
      }
    }
    category = c as 'push' | 'pull' | 'legs' | 'other'
  }

  if (!Array.isArray(input.exercises) || input.exercises.length === 0) {
    return { ok: false, reason: 'Add at least one exercise.' }
  }
  if (input.exercises.length > 20) {
    return { ok: false, reason: 'Max 20 exercises per day.' }
  }

  const exercises: CreateDayExerciseInput[] = []
  for (const raw of input.exercises) {
    const name = String(raw.name ?? '').trim()
    if (!name) {
      return { ok: false, reason: 'Every exercise needs a name.' }
    }
    const sets = Number(raw.sets_target)
    if (!Number.isFinite(sets) || sets < 1 || sets > 12) {
      return {
        ok: false,
        reason: `Sets for "${name}" must be between 1 and 12.`,
      }
    }
    const reps = String(raw.reps_target ?? '').trim() || '8-12'
    let weight: number | null = null
    if (
      raw.weight_target_lbs != null &&
      Number.isFinite(Number(raw.weight_target_lbs))
    ) {
      weight = Number(raw.weight_target_lbs)
    }
    exercises.push({
      name,
      sets_target: Math.round(sets),
      reps_target: reps.slice(0, 24),
      weight_target_lbs: weight,
    })
  }

  return { ok: true, dayKey, category, exercises }
}

export async function previewCreateDay(
  supabase: SupabaseClient,
  args: {
    userId: string
    conversationId: string | null
    dayKey: string
    category?: string | null
    exercises: CreateDayExerciseInput[]
  },
): Promise<
  | { ok: true; proposal: CoachProposalView }
  | { ok: false; reason: string }
> {
  const validated = validateCreateDayInput(args)
  if (!validated.ok) return validated

  const { data: existing } = await supabase
    .from('exercises')
    .select('id')
    .eq('user_id', args.userId)
    .eq('day_type', validated.dayKey)
    .limit(1)

  if (existing && existing.length > 0) {
    return {
      ok: false,
      reason: `You already have a day named "${validated.dayKey}". Pick a different name.`,
    }
  }

  const payload: CoachActionPayload = {
    kind: 'create_day',
    card: {
      title: 'Create workout day',
      summaryLines: [
        `Day: ${validated.dayKey}`,
        validated.category
          ? `Category: ${validated.category}`
          : 'Category: (none)',
        `${validated.exercises.length} exercise${validated.exercises.length === 1 ? '' : 's'}`,
        validated.exercises
          .slice(0, 4)
          .map(e => e.name)
          .join(', ') +
          (validated.exercises.length > 4
            ? ` +${validated.exercises.length - 4} more`
            : ''),
      ],
      riskNote: 'Adds exercises to your catalog. Does not start a session.',
      steps: validated.exercises.map(
        e =>
          `${e.name} · ${e.sets_target} × ${e.reps_target}${
            e.weight_target_lbs != null ? ` @ ${e.weight_target_lbs} lb` : ''
          }`,
      ),
    },
    execute: {
      dayKey: validated.dayKey,
      category: validated.category,
      exercises: validated.exercises,
    },
  }

  const proposal = await insertCoachProposal(supabase, {
    userId: args.userId,
    conversationId: args.conversationId,
    payload,
  })
  if (!proposal) {
    return {
      ok: false,
      reason:
        'Could not save the proposal. Apply docs/sql/36-coach-actions.sql if you have not yet.',
    }
  }
  return { ok: true, proposal }
}

export async function executeCreateDay(
  supabase: SupabaseClient,
  args: {
    userId: string
    dayKey: string
    category: 'push' | 'pull' | 'legs' | 'other' | null
    exercises: CreateDayExerciseInput[]
  },
): Promise<{ ok: true; inserted: number } | { ok: false; message: string }> {
  const validated = validateCreateDayInput(args)
  if (!validated.ok) return { ok: false, message: validated.reason }

  const { data: existing } = await supabase
    .from('exercises')
    .select('id')
    .eq('user_id', args.userId)
    .eq('day_type', validated.dayKey)
    .limit(1)
  if (existing && existing.length > 0) {
    return {
      ok: false,
      message: `Day "${validated.dayKey}" already exists.`,
    }
  }

  const rows = validated.exercises.map((e, i) => ({
    user_id: args.userId,
    name: e.name,
    day_type: validated.dayKey,
    sets_target: e.sets_target,
    reps_target: e.reps_target,
    weight_target: e.weight_target_lbs ?? null,
    sort_order: i + 1,
    active: true,
  }))

  const { error: insertError } = await supabase.from('exercises').insert(rows)
  if (insertError) {
    return { ok: false, message: insertError.message }
  }

  if (validated.category) {
    const { error: catError } = await supabase.from('user_day_categories').upsert(
      {
        user_id: args.userId,
        day_key: validated.dayKey,
        category: validated.category,
      },
      { onConflict: 'user_id,day_key' },
    )
    if (catError) {
      console.error('[grind] coach create_day category', catError)
    }
  }

  return { ok: true, inserted: rows.length }
}
