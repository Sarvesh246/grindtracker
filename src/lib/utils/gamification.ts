// XP required to advance from level n to n+1 = 500 * n
// Cumulative XP to reach level n = 500 * n * (n-1) / 2
export function getXpRequiredForLevel(level: number): number {
  return 500 * level
}

export function getLevel(xpTotal: number): number {
  return Math.floor((1 + Math.sqrt(1 + 8 * xpTotal / 500)) / 2)
}

export function getXpInCurrentLevel(xpTotal: number): number {
  const level = getLevel(xpTotal)
  const levelStart = 500 * (level - 1) * level / 2
  return xpTotal - levelStart
}

export function getXpToNextLevel(xpTotal: number): number {
  const level = getLevel(xpTotal)
  return getXpRequiredForLevel(level) - getXpInCurrentLevel(xpTotal)
}

import { localDateKey } from './formatting'

const CANONICAL_DAY_ORDER = ['push', 'pull', 'legs']
// A rotation day untouched for this many days (or never trained) is "overdue".
const OVERDUE_DAYS = 7

export interface RotationDay {
  dayType: string
  /** Whole calendar days since this day was last completed; null = never. */
  daysSince: number | null
  /** The single day we suggest training next (least recently trained). */
  recommended: boolean
  /** Has fallen behind the rotation — surfaced so skipped days aren't lost. */
  overdue: boolean
}

/**
 * Stable display order for workout days: canonical push → pull → legs first,
 * then any custom days alphabetically.
 */
export function orderDayTypes(dayTypes: string[]): string[] {
  return [...new Set(dayTypes)].sort((a, b) => {
    const ia = CANONICAL_DAY_ORDER.indexOf(a)
    const ib = CANONICAL_DAY_ORDER.indexOf(b)
    const ra = ia === -1 ? CANONICAL_DAY_ORDER.length : ia
    const rb = ib === -1 ? CANONICAL_DAY_ORDER.length : ib
    return ra - rb || a.localeCompare(b)
  })
}

// Whole calendar days between a past ISO timestamp and `now`, derived from local
// date keys so the count never drifts with the user's timezone (see localDateKey).
function calendarDaysSince(iso: string, now: Date): number {
  const from = new Date(localDateKey(new Date(iso)) + 'T12:00:00')
  const to = new Date(localDateKey(now) + 'T12:00:00')
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000))
}

/**
 * Skip-aware workout rotation. Instead of blindly advancing push → pull → legs
 * from the last session, this recommends the day trained *least recently* (a
 * never-trained day is the most overdue of all) and flags days that have fallen
 * behind. So if you do push → pull → push instead of legs, legs floats to the
 * top as the recommendation and is highlighted as overdue rather than silently
 * dropping out of the suggestion. In a healthy rotation it still reproduces the
 * normal cycle, since the day you trained longest ago is the one that comes next.
 */
export function computeRotation(
  dayTypes: string[],
  lastTrainedByDay: Record<string, string | null>,
  now: Date = new Date(),
): RotationDay[] {
  const ordered = orderDayTypes(dayTypes)

  let recommended: string | null = null
  let bestRank = -Infinity
  ordered.forEach((day, idx) => {
    const last = lastTrainedByDay[day] ?? null
    // Higher rank = more overdue. A never-trained day outranks every trained
    // day, with earlier display order breaking ties among never-trained days.
    const rank = last === null
      ? Number.MAX_SAFE_INTEGER - idx
      : now.getTime() - new Date(last).getTime()
    if (rank > bestRank) {
      bestRank = rank
      recommended = day
    }
  })

  return ordered.map(day => {
    const last = lastTrainedByDay[day] ?? null
    const daysSince = last === null ? null : calendarDaysSince(last, now)
    return {
      dayType: day,
      daysSince,
      recommended: day === recommended,
      overdue: daysSince === null || daysSince >= OVERDUE_DAYS,
    }
  })
}
