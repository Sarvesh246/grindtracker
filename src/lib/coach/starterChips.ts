import { formatDayType } from '@/lib/utils/formatting'

export type CoachChipHints = {
  hasActiveSession: boolean
  nextDay: string | null
  lastPrExercise: string | null
}

const WORKOUT_CHIPS = [
  'Weight for this set?',
  'What to skip?',
  "How's this session going?",
] as const

const GENERIC_CHIPS = [
  "How's my streak?",
  'Recent PRs?',
  'What did I do last workout?',
  'Am I progressing?',
] as const

const MAX_CHIPS = 4

/**
 * Context-aware empty-state starter chips. Each chip still sends a normal
 * user message (burns quota) — same path as free-typed asks.
 */
export function coachStarterChips(
  opts: {
    /** `/log?day=` ActiveWorkout — treat as open session without waiting on GET. */
    inWorkout?: boolean
  } & Partial<CoachChipHints>,
): string[] {
  if (opts.inWorkout || opts.hasActiveSession) {
    return [...WORKOUT_CHIPS]
  }

  const out: string[] = []
  const next = opts.nextDay?.trim()
  if (next) {
    out.push(`Ready for ${formatDayType(next)}?`)
  }
  const pr = opts.lastPrExercise?.trim()
  if (pr) {
    out.push(`Break down my ${pr} PR?`)
  }

  for (const chip of GENERIC_CHIPS) {
    if (out.length >= MAX_CHIPS) break
    if (!out.includes(chip)) out.push(chip)
  }
  return out.slice(0, MAX_CHIPS)
}
