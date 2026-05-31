import type { UserRotation } from '@/lib/types'

/**
 * Rotation helpers — pure, framework-agnostic (no Supabase import) so they run on
 * both server and client and stay easy to test.
 *
 * The "rotation" is an ordered loop of day_keys that drives the *suggested* next
 * workout. A day may repeat (e.g. abs after every other day). It is non-binding —
 * the user can still train any day.
 */

/** Auto order: every day once, alphabetical — matches the ordering used elsewhere
 *  (DaySelect / WorkoutManager group exercises and sort the keys). */
export function autoSequence(dayKeys: string[]): string[] {
  return [...dayKeys].sort()
}

/** The order actually in effect for a user, given their current days.
 *  Manual sequences are filtered to keys that still have exercises so deleted
 *  days drop out cleanly. */
export function effectiveSequence(row: UserRotation | null, dayKeys: string[]): string[] {
  if (row && row.mode === 'manual') {
    const valid = new Set(dayKeys)
    return row.sequence.filter(k => valid.has(k))
  }
  return autoSequence(dayKeys)
}

/** The next day to suggest, stepping forward from `currentIndex` (wrapping).
 *  Pass `currentIndex = -1` (or any value) to get the first slot when there is no
 *  history yet. Returns null when there are no days. */
export function nextDay(seq: string[], currentIndex: number): string | null {
  if (seq.length === 0) return null
  const i = ((currentIndex + 1) % seq.length + seq.length) % seq.length
  return seq[i]
}

/** Advance the pointer after completing `completedDayKey`: the first slot at or
 *  after `currentIndex + 1` (wrapping once) that equals the completed day. If the
 *  day isn't in the sequence, the pointer is left unchanged. Deterministic, and
 *  disambiguates a day that appears multiple times. */
export function advanceIndex(seq: string[], currentIndex: number, completedDayKey: string): number {
  if (seq.length === 0) return currentIndex
  for (let step = 1; step <= seq.length; step++) {
    const i = (currentIndex + step) % seq.length
    if (seq[i] === completedDayKey) return i
  }
  return currentIndex
}
