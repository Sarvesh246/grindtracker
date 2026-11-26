interface ExercisePlan {
  id: string
  name: string
  sets_target: number
  reps_target: string
  weight_target: number | null
}

interface LoggedSet {
  set_number: number
  weight: number | null
  reps: number | null
  is_skipped: boolean
}

export interface LoadSuggestion {
  exercise: ExercisePlan
  weight: number
  reps: number[]
  range: string
}

/** Suggest an increase after every working set clears an explicit rep range at the same load. */
export function getLoadSuggestion(exercise: ExercisePlan, rows: LoggedSet[]): LoadSuggestion | null {
  const range = /^\s*(\d+)\s*[-–—]\s*(\d+)\s*$/.exec(exercise.reps_target)
  if (!range || Number(range[1]) < 1 || Number(range[2]) <= Number(range[1])) return null
  const sets = [...rows].sort((a, b) => a.set_number - b.set_number)
  const weight = sets[0]?.weight
  if (sets.length < exercise.sets_target || weight == null || weight <= 0) return null
  if (exercise.weight_target != null && Math.abs(exercise.weight_target - weight) > 0.05) return null

  const reps: number[] = []
  for (const set of sets) {
    if (set.is_skipped || set.weight == null || Math.abs(set.weight - weight) > 0.05
      || set.reps == null || set.reps < Number(range[2])) return null
    reps.push(set.reps)
  }
  return { exercise, weight, reps, range: `${range[1]}–${range[2]}` }
}
