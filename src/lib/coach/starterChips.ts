import { formatDayType } from '@/lib/utils/formatting'

export type CoachChipHints = {
  hasActiveSession: boolean
  nextDay: string | null
  lastPrExercise: string | null
  /** Today's Charge (0–100) for watch users with Coach body data on, else null. */
  chargeScore?: number | null
}

/** Charge below this offers a lighter day; above CHARGE_PR_ABOVE offers a PR. */
export const CHARGE_LIGHTER_BELOW = 50
export const CHARGE_PR_ABOVE = 80
export const LIGHTER_TODAY_CHIP = 'Lighter version of today?'
export const PR_TODAY_CHIP = 'Go for a PR today?'

function chargeChip(score: number | null | undefined): string | null {
  if (score == null || !Number.isFinite(score)) return null
  if (score < CHARGE_LIGHTER_BELOW) return LIGHTER_TODAY_CHIP
  if (score > CHARGE_PR_ABOVE) return PR_TODAY_CHIP
  return null
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
  // Watch readiness leads only at the extremes; a middling Charge changes nothing.
  const charge = chargeChip(opts.chargeScore)
  if (charge) out.push(charge)
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
