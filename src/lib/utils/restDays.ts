import { localDateKey } from './formatting'

/**
 * Rest-day helpers — pure, framework-agnostic (no Supabase import) so they run on
 * both server and client, exactly like `rotation.ts`.
 *
 * A rest day is a day you planned not to train. It BRIDGES a streak rather than
 * counting toward it: the streak number stays "workouts in this unbroken run", so
 * resting can never inflate it. Two kinds:
 *
 *   • scheduled — a weekday in `user_rest_settings.weekdays` (0 = Sunday … 6 =
 *     Saturday, matching Postgres `extract(dow)`). Unlimited: it's your program.
 *   • claimed   — a one-off pass on a specific date, spent from the home screen
 *     when a day got away from you. Rationed by the constants below.
 *
 * ⚠️  The constants and the "is this date a rest day" rule are mirrored in
 *     docs/sql/14-rest-days.sql, which is the ACTUAL enforcement (the client has
 *     no INSERT privilege on `user_rest_dates`). Change one, change both. These
 *     exist so the UI can pre-check and explain, never to grant anything.
 */

/** Rest passes allowed inside any rolling window. */
export const REST_PASS_LIMIT = 2
/** Length of that rolling window, in days. Also how far back a pass may reach. */
export const REST_PASS_WINDOW_DAYS = 7

/** Postgres `extract(dow)` order: index 0 = Sunday. */
export const WEEKDAYS: { value: number; short: string; letter: string; full: string }[] = [
  { value: 0, short: 'Sun', letter: 'S', full: 'Sunday' },
  { value: 1, short: 'Mon', letter: 'M', full: 'Monday' },
  { value: 2, short: 'Tue', letter: 'T', full: 'Tuesday' },
  { value: 3, short: 'Wed', letter: 'W', full: 'Wednesday' },
  { value: 4, short: 'Thu', letter: 'T', full: 'Thursday' },
  { value: 5, short: 'Fri', letter: 'F', full: 'Friday' },
  { value: 6, short: 'Sat', letter: 'S', full: 'Saturday' },
]

/** At least one training day has to remain or "streak" stops meaning anything. */
export const MAX_REST_WEEKDAYS = 6

export interface RestConfig {
  /** Scheduled rest weekdays, 0 = Sunday … 6 = Saturday. */
  weekdays: number[]
  /** `YYYY-MM-DD` keys of rest passes already claimed. */
  claimed: string[]
}

/** Parse a stored `YYYY-MM-DD` key at LOCAL noon — never `new Date(key)`, which
 *  is UTC midnight and lands on the previous day west of Greenwich. */
export function parseDateKey(key: string): Date {
  return new Date(key + 'T12:00:00')
}

/** `n` days after a `YYYY-MM-DD` key, as another key. Negative `n` goes back. */
export function shiftDateKey(key: string, n: number): string {
  const d = parseDateKey(key)
  d.setDate(d.getDate() + n)
  return localDateKey(d)
}

/** Whole calendar days from `from` to `to` (both `YYYY-MM-DD`). Can be negative. */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseDateKey(to).getTime() - parseDateKey(from).getTime()) / 86_400_000)
}

/** Weekday index (0 = Sunday) of a date key, in the viewer's own calendar. */
export function weekdayOf(key: string): number {
  return parseDateKey(key).getDay()
}

/** Mirror of `grind_is_rest_day()`: scheduled weekday OR a claimed pass. */
export function isRestDate(key: string, config: RestConfig): boolean {
  return config.weekdays.includes(weekdayOf(key)) || config.claimed.includes(key)
}

/**
 * The days between the last workout and today that are NOT covered by rest —
 * i.e. exactly what is breaking (or about to break) the streak. Today itself is
 * excluded: there's still time to train.
 *
 * Returns oldest-first, and empty when the streak is safe. A `null`
 * `lastWorkoutKey` (no history at all) has nothing to protect, so also empty.
 */
export function uncoveredGapDays(
  lastWorkoutKey: string | null,
  config: RestConfig,
  today: Date = new Date(),
): string[] {
  if (!lastWorkoutKey) return []
  const todayKey = localDateKey(today)
  const span = daysBetween(lastWorkoutKey, todayKey)
  // Nothing in between (trained today or yesterday), or a clock skew that put the
  // last workout ahead of today — either way there is no gap to cover.
  if (span <= 1) return []
  // Beyond the reach of a pass anyway; enumerating years of dates helps nobody.
  if (span > 400) return []

  const out: string[] = []
  for (let i = 1; i < span; i++) {
    const key = shiftDateKey(lastWorkoutKey, i)
    if (!isRestDate(key, config)) out.push(key)
  }
  return out
}

/** Rest passes spent inside the rolling window, mirroring the SQL's count. */
export function passesUsed(claimed: string[], today: Date = new Date()): number {
  const cutoff = shiftDateKey(localDateKey(today), -REST_PASS_WINDOW_DAYS)
  return claimed.filter(key => key > cutoff).length
}

/** Passes still available right now. */
export function passesRemaining(claimed: string[], today: Date = new Date()): number {
  return Math.max(0, REST_PASS_LIMIT - passesUsed(claimed, today))
}

/**
 * Can the streak actually be rescued by spending passes? Every uncovered day has
 * to be inside the claimable window AND there have to be enough passes left. This
 * is only a pre-check so the UI can offer the right thing — `claim_rest_days`
 * re-validates all of it server-side.
 */
export function canRescueStreak(
  gap: string[],
  claimed: string[],
  today: Date = new Date(),
): boolean {
  if (gap.length === 0) return false
  const todayKey = localDateKey(today)
  const inWindow = gap.every(key => daysBetween(key, todayKey) <= REST_PASS_WINDOW_DAYS)
  return inWindow && gap.length <= passesRemaining(claimed, today)
}

/** "Sun & Wed" / "Mon, Wed & Fri" — for settings summaries. */
export function describeRestWeekdays(weekdays: number[]): string {
  const names = [...weekdays]
    .sort((a, b) => a - b)
    .map(v => WEEKDAYS[v]?.short)
    .filter(Boolean) as string[]
  if (names.length === 0) return 'None set'
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`
}

/** "Wed, Jul 30" — a gap day, rendered from its key at local noon. */
export function formatGapDay(key: string): string {
  return parseDateKey(key).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Map a `claim_rest_days` error message to something a person can act on. The
 * RPC raises tagged exceptions (`REST_LIMIT: …`) precisely so the tag survives
 * PostgREST and the copy can live here rather than in the database.
 */
export function restClaimErrorMessage(raw: string | undefined | null): string {
  const msg = raw ?? ''
  if (msg.includes('REST_LIMIT')) {
    return `You've used all ${REST_PASS_LIMIT} rest days for this week.`
  }
  if (msg.includes('REST_TOO_OLD')) {
    return `Rest days can only be claimed for the last ${REST_PASS_WINDOW_DAYS} days.`
  }
  if (msg.includes('REST_DATE_TRAINED')) {
    return 'You already logged a workout on that day.'
  }
  if (msg.includes('REST_FUTURE_DATE')) {
    return "You can't claim a rest day that hasn't happened yet."
  }
  return "Couldn't save that rest day. Check your connection and try again."
}
