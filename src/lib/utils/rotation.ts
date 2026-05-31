import type { UserRotation } from '@/lib/types'
import { localDateKey } from './formatting'

/**
 * Rotation helpers — pure, framework-agnostic (no Supabase import) so they run on
 * both server and client and stay easy to test.
 *
 * The "rotation" is an ordered loop of day_keys that drives the *suggested* next
 * workout. A day may repeat (e.g. abs after every other day). It is non-binding —
 * the user can still train any day.
 */

export interface OverdueDay {
  dayType: string
  /** Whole calendar days since this day was last completed; null = never. */
  daysSince: number | null
}

/** Whole calendar days between a past ISO timestamp and `now`, derived from local
 *  date keys so the count never drifts with the viewer's timezone — compute this
 *  client-side (see localDateKey + the Dates & timezones note in CLAUDE.md). */
export function calendarDaysSince(iso: string, now: Date = new Date()): number {
  const from = new Date(localDateKey(new Date(iso)) + 'T12:00:00')
  const to = new Date(localDateKey(now) + 'T12:00:00')
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000))
}

/** Forward steps from `currentIndex` to the nearest slot holding `day` (wrapping).
 *  The next-up day is distance 1; the just-completed day at the pointer is L. */
function queueDistance(seq: string[], currentIndex: number, day: string): number {
  const L = seq.length
  for (let step = 1; step <= L; step++) {
    const i = ((currentIndex + step) % L + L) % L
    if (seq[i] === day) return step
  }
  return Infinity
}

/**
 * Days the rotation pointer has *skipped past* — surfaced as a subtle "overdue"
 * nudge so a day you jumped over isn't silently lost. NOT the same as "the day
 * you haven't trained the longest": that is simply the next/earliest slot, which
 * a healthy in-order rotation reproduces every cycle and which we never flag.
 *
 * A day D is overdue when some other day E is due *sooner* (closer to the pointer)
 * yet was trained *more recently* than D. In an in-order rotation the soonest-due
 * day is always the one trained longest ago, so that inversion only happens when
 * you trained a later day out of order and left D behind. The just-completed day
 * sits at the far end of the queue, so finishing a workout never flags anything.
 *
 * Pure. `lastTrainedByDay` maps day_key → last completed ISO timestamp (null/absent
 * = never trained, treated as oldest). Returns most-overdue-first.
 */
export function overdueDays(
  seq: string[],
  currentIndex: number,
  lastTrainedByDay: Record<string, string | null>,
  now: Date = new Date(),
): OverdueDay[] {
  const days = [...new Set(seq)]
  const recency = (d: string): number => {
    const iso = lastTrainedByDay[d] ?? null
    return iso === null ? -Infinity : new Date(iso).getTime()
  }
  const dist = (d: string) => queueDistance(seq, currentIndex, d)

  const skipped = days.filter(d =>
    days.some(e => e !== d && dist(e) < dist(d) && recency(e) > recency(d)),
  )

  return skipped
    .map(dayType => {
      const iso = lastTrainedByDay[dayType] ?? null
      return { dayType, daysSince: iso === null ? null : calendarDaysSince(iso, now) }
    })
    // Most overdue first: never-trained, then largest daysSince.
    .sort((a, b) => (b.daysSince ?? Infinity) - (a.daysSince ?? Infinity))
}

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
