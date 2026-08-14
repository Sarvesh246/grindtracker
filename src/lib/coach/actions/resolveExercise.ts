import type { SupabaseClient } from '@supabase/supabase-js'

export type ResolvedExercise = {
  id: string
  name: string
  day_type: string
  sets_target: number
  reps_target: string
  weight_target: number | null
  active: boolean
}

export function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Fuzzy-match an exercise by name (exact, then substring either way).
 * When several partials hit, prefer a single exact name match.
 */
export function pickExerciseByName<T extends { name: string }>(
  exercises: T[],
  rawName: string,
): { ok: true; exercise: T } | { ok: false; reason: string } {
  const needle = normalizeName(rawName)
  if (!needle) {
    return { ok: false, reason: 'Exercise name is required.' }
  }

  const matched = exercises.filter(e => {
    const n = normalizeName(String(e.name ?? ''))
    return n === needle || n.includes(needle) || needle.includes(n)
  })

  if (matched.length === 0) {
    return {
      ok: false,
      reason: `No exercise matching "${rawName}" in your catalog.`,
    }
  }
  if (matched.length > 1) {
    const exact = matched.filter(
      e => normalizeName(String(e.name)) === needle,
    )
    if (exact.length !== 1) {
      return {
        ok: false,
        reason: `Multiple exercises match "${rawName}". Be more specific (${matched
          .map(e => e.name)
          .slice(0, 4)
          .join(', ')}).`,
      }
    }
    return { ok: true, exercise: exact[0]! }
  }
  return { ok: true, exercise: matched[0]! }
}

/**
 * Load the caller's catalog and resolve one exercise by name.
 * Optional `dayType` narrows the search (same name can exist on multiple days).
 */
export async function resolveExerciseByName(
  supabase: SupabaseClient,
  userId: string,
  name: string,
  opts?: { dayType?: string | null },
): Promise<
  | { ok: true; exercise: ResolvedExercise }
  | { ok: false; reason: string }
> {
  const { data, error } = await supabase
    .from('exercises')
    .select('id, name, day_type, sets_target, reps_target, weight_target, active')
    .eq('user_id', userId)

  if (error) {
    return { ok: false, reason: 'Could not load your exercises.' }
  }

  const all = (data ?? []) as ResolvedExercise[]
  const dayNeedle = opts?.dayType ? normalizeName(opts.dayType) : ''
  const pool = dayNeedle
    ? all.filter(e => normalizeName(e.day_type) === dayNeedle)
    : all

  if (dayNeedle && pool.length === 0) {
    return {
      ok: false,
      reason: `No day named "${opts!.dayType}". Your days: ${[
        ...new Set(all.map(e => e.day_type)),
      ].join(', ') || '(none)'}.`,
    }
  }

  const picked = pickExerciseByName(pool, name)
  if (!picked.ok && dayNeedle) {
    const other = pickExerciseByName(all, name)
    if (other.ok) {
      return {
        ok: false,
        reason: `"${other.exercise.name}" is on ${other.exercise.day_type}, not ${opts!.dayType}.`,
      }
    }
  }
  return picked
}
