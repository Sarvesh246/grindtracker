import type { SupabaseClient } from '@supabase/supabase-js'
import { writeRotationRow } from './rotationStore'
import { getWorkoutTemplate } from '@/lib/utils/workoutTemplates'

export type ApplyWorkoutTemplateResult =
  | { ok: true; label: string }
  | { ok: false; error: string }

/**
 * Bulk-create a starter split: exercises, leaderboard categories, and a manual
 * rotation matching the template sequence. Shared by WorkoutManager (blank
 * slate) and the first-run setup wizard.
 */
export async function applyWorkoutTemplate(
  supabase: SupabaseClient,
  userId: string,
  templateId: string,
): Promise<ApplyWorkoutTemplateResult> {
  const template = getWorkoutTemplate(templateId)
  if (!template) {
    return { ok: false, error: 'Unknown template.' }
  }

  const failure: ApplyWorkoutTemplateResult = {
    ok: false,
    error: 'Could not set up your template. Check your connection and try again.',
  }

  // `exercises` has no unique constraint, so a retry after a partial failure
  // would insert the whole template again. Make the call idempotent: only add
  // exercises for template days that have none yet, then categories, then the
  // rotation - sequentially, exercises first, so each step can be safely re-run.
  const { data: existing, error: readError } = await supabase
    .from('exercises')
    .select('day_type')
    .eq('user_id', userId)
  if (readError) return failure
  const haveDays = new Set((existing ?? []).map((r: { day_type: string }) => r.day_type))

  const exerciseRows = Object.entries(template.days)
    .filter(([dayKey]) => !haveDays.has(dayKey))
    .flatMap(([dayKey, day]) =>
      day.exercises.map((ex, i) => ({
        user_id: userId,
        name: ex.name,
        day_type: dayKey,
        sets_target: ex.sets,
        reps_target: ex.reps,
        sort_order: i + 1,
        active: ex.active ?? true,
      })),
    )
  const categoryRows = Object.entries(template.days).map(([dayKey, day]) => ({
    user_id: userId,
    day_key: dayKey,
    category: day.category,
  }))

  if (exerciseRows.length > 0) {
    const { error: exError } = await supabase.from('exercises').insert(exerciseRows)
    if (exError) return failure
  }

  const { error: catError } = await supabase
    .from('user_day_categories')
    .upsert(categoryRows, { onConflict: 'user_id,day_key' })
  if (catError) return failure

  const { error: rotError } = await writeRotationRow(supabase, {
    user_id: userId,
    mode: 'manual',
    sequence: template.sequence,
    current_index: -1, // pointer = last completed slot; -1 ⇒ first day is next
    current_day: null,
  })
  if (rotError) return failure

  return { ok: true, label: template.label }
}
