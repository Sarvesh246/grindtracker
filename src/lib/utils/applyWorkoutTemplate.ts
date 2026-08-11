import type { SupabaseClient } from '@supabase/supabase-js'
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

  const exerciseRows = Object.entries(template.days).flatMap(([dayKey, day]) =>
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

  const [{ error: exError }, { error: catError }, { error: rotError }] = await Promise.all([
    supabase.from('exercises').insert(exerciseRows),
    supabase.from('user_day_categories').upsert(categoryRows, { onConflict: 'user_id,day_key' }),
    supabase.from('user_rotation').upsert(
      {
        user_id: userId,
        mode: 'manual',
        sequence: template.sequence,
        current_index: 0,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    ),
  ])

  if (exError || catError || rotError) {
    return {
      ok: false,
      error: 'Could not set up your template. Check your connection and try again.',
    }
  }

  return { ok: true, label: template.label }
}
