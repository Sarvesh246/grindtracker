/**
 * Compact training-tenure / gap summary for Coach USER_DATA.
 * Pure helpers — no Supabase; easy to unit-test.
 */

/** Idle calendar days between two workouts (or last workout → as_of) that count as a break. */
export const COACH_SIGNIFICANT_BREAK_DAYS = 14

/** Cap listed breaks so the prompt pack stays small. */
export const COACH_CONTEXT_MAX_BREAKS = 8

export interface TrainingBreak {
  /** Last workout date before the idle stretch (YYYY-MM-DD). */
  after: string
  /**
   * Next workout date that ended the break, or null when the stretch is still
   * open through as_of_local_date (user has not logged since `after`).
   */
  before: string | null
  /** Calendar days with no completed workout between the endpoints. */
  idle_days: number
}

export interface TrainingHistorySummary {
  first_workout_date: string | null
  last_workout_date: string | null
  /** Inclusive span from first workout → as_of (0 when no history). */
  days_since_first_workout: number | null
  days_since_last_workout: number | null
  /** Distinct local calendar days with ≥1 completed session. */
  total_workout_days: number
  workouts_last_30_days: number
  workouts_last_90_days: number
  longest_break_days: number
  /**
   * Significant layoffs (idle ≥ COACH_SIGNIFICANT_BREAK_DAYS), newest first.
   * Includes an open stretch after the last workout when still idle that long.
   */
  significant_breaks: TrainingBreak[]
}

function parseDateKey(key: string): Date {
  return new Date(key + 'T12:00:00')
}

/** Whole calendar days from `fromKey` to `toKey` (can be negative). */
export function calendarDaysBetween(fromKey: string, toKey: string): number {
  const a = parseDateKey(fromKey).getTime()
  const b = parseDateKey(toKey).getTime()
  return Math.round((b - a) / 86_400_000)
}

/**
 * Deduplicate + sort ascending workout date keys. Ignores empty/invalid-looking
 * strings (non YYYY-MM-DD) so a bad row cannot poison the summary.
 */
export function normalizeWorkoutDates(dates: (string | null | undefined)[]): string[] {
  const re = /^\d{4}-\d{2}-\d{2}$/
  const unique = new Set<string>()
  for (const d of dates) {
    if (typeof d === 'string' && re.test(d)) unique.add(d)
  }
  return Array.from(unique).sort()
}

function shiftDateKey(key: string, deltaDays: number): string {
  const d = parseDateKey(key)
  d.setDate(d.getDate() + deltaDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Inclusive window: asOf and the prior (windowDays - 1) calendar days. */
function countInWindow(
  sortedAsc: string[],
  asOf: string,
  windowDays: number,
): number {
  const earliest = shiftDateKey(asOf, -(windowDays - 1))
  let n = 0
  for (let i = sortedAsc.length - 1; i >= 0; i--) {
    const key = sortedAsc[i]!
    if (key > asOf) continue
    if (key < earliest) break
    n++
  }
  return n
}

/**
 * Build a token-cheap tenure/gap snapshot from distinct workout dates.
 * `asOfLocalDate` is the user's local today (same rule as buildCoachContext).
 */
export function summarizeTrainingHistory(
  workoutDates: (string | null | undefined)[],
  asOfLocalDate: string,
): TrainingHistorySummary {
  const sorted = normalizeWorkoutDates(workoutDates).filter(d => d <= asOfLocalDate)
  if (sorted.length === 0) {
    return {
      first_workout_date: null,
      last_workout_date: null,
      days_since_first_workout: null,
      days_since_last_workout: null,
      total_workout_days: 0,
      workouts_last_30_days: 0,
      workouts_last_90_days: 0,
      longest_break_days: 0,
      significant_breaks: [],
    }
  }

  const first = sorted[0]!
  const last = sorted[sorted.length - 1]!
  const breaks: TrainingBreak[] = []
  let longest = 0

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!
    const next = sorted[i]!
    const idle = calendarDaysBetween(prev, next) - 1
    if (idle > longest) longest = idle
    if (idle >= COACH_SIGNIFICANT_BREAK_DAYS) {
      breaks.push({ after: prev, before: next, idle_days: idle })
    }
  }

  const openIdle = calendarDaysBetween(last, asOfLocalDate)
  // openIdle is days since last workout (0 = trained today). Count as break
  // when they've been idle that long without a new session yet.
  if (openIdle > longest) longest = openIdle
  if (openIdle >= COACH_SIGNIFICANT_BREAK_DAYS) {
    breaks.push({ after: last, before: null, idle_days: openIdle })
  }

  // Newest first; keep the largest remaining if over cap (prefer recent).
  breaks.sort((a, b) => {
    if (a.after !== b.after) return a.after < b.after ? 1 : -1
    return b.idle_days - a.idle_days
  })
  const significant_breaks = breaks.slice(0, COACH_CONTEXT_MAX_BREAKS)

  return {
    first_workout_date: first,
    last_workout_date: last,
    days_since_first_workout: calendarDaysBetween(first, asOfLocalDate),
    days_since_last_workout: openIdle,
    total_workout_days: sorted.length,
    workouts_last_30_days: countInWindow(sorted, asOfLocalDate, 30),
    workouts_last_90_days: countInWindow(sorted, asOfLocalDate, 90),
    longest_break_days: longest,
    significant_breaks,
  }
}
