import { localDateKey } from './formatting'

/**
 * Rest-day helpers — pure, framework-agnostic (no Supabase import), same style
 * as rotation.ts. Mirrors the SQL connectivity semantics in
 * docs/sql/14-rest-days.sql + docs/sql/39-rest-day-skip.sql, so the client can
 * reason about streak gaps using the viewer's own local "today" (never the
 * server's — see Dates & timezones in CLAUDE.md).
 */

/** Parse a 'YYYY-MM-DD' key as local noon, avoiding the UTC-midnight shift a
 *  bare `new Date(key)` would introduce for timezones behind UTC (same trap
 *  localDateKey exists to avoid; mirrors the anchor formatShortDate uses). */
function parseDateKey(key: string): Date {
  return new Date(key + 'T12:00:00')
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

export type RestDayOpts = {
  /** Recurring weekdays suppressed this week because a skip used the budget. */
  cancels?: Set<string>
  /** day_of_week → YYYY-MM-DD first date that weekday counts (39). Missing = always. */
  effectiveFrom?: Map<number, string>
  /** Completed-workout dates — training on a scheduled rest day does not spend a skip. */
  trainedDates?: Set<string>
}

/** True if `dateKey` is a rest day: one-off confirmed date, or a recurring
 *  weekday that has reached `effectiveFrom` and is not cancelled. */
export function isRestDay(
  dateKey: string,
  recurringDaysOfWeek: Set<number>,
  oneOffDates: Set<string>,
  opts?: RestDayOpts,
): boolean {
  if (oneOffDates.has(dateKey)) return true
  if (opts?.cancels?.has(dateKey)) return false
  const dow = parseDateKey(dateKey).getDay()
  if (!recurringDaysOfWeek.has(dow)) return false
  const from = opts?.effectiveFrom?.get(dow)
  if (from && dateKey < from) return false
  return true
}

/**
 * Calendar dates strictly between `fromKey` and `toKey` (both endpoints
 * excluded) that are NOT covered by a rest day — mirrors the SQL
 * `grind_dates_connected` helper exactly (docs/sql/14-rest-days.sql).
 * Order-independent, like the SQL version: the SET of days strictly between
 * two dates doesn't depend on which one is chronologically first. Returns
 * dates ascending as 'YYYY-MM-DD' keys.
 */
export function uncoveredDatesBetween(
  fromKey: string,
  toKey: string,
  recurringDaysOfWeek: Set<number>,
  oneOffDates: Set<string>,
  opts?: RestDayOpts,
): string[] {
  const a = parseDateKey(fromKey)
  const b = parseDateKey(toKey)
  const start = a.getTime() <= b.getTime() ? a : b
  const end = a.getTime() <= b.getTime() ? b : a

  const uncovered: string[] = []
  let cursor = addDays(start, 1)
  while (cursor.getTime() < end.getTime()) {
    const key = localDateKey(cursor)
    if (!isRestDay(key, recurringDaysOfWeek, oneOffDates, opts)) uncovered.push(key)
    cursor = addDays(cursor, 1)
  }
  return uncovered
}

/** Two dates are "connected" — a streak spanning the gap between them isn't
 *  broken — when every day strictly between them is a rest day. A 0- or
 *  1-day gap has no days strictly between the endpoints, so it's trivially
 *  connected. Mirrors grind_dates_connected() in docs/sql/14-rest-days.sql,
 *  which is the source of truth server-side; this is only used client-side
 *  to avoid flashing an optimistic "streak broken" state the server would
 *  immediately contradict. */
export function datesConnected(
  fromKey: string,
  toKey: string,
  recurringDaysOfWeek: Set<number>,
  oneOffDates: Set<string>,
  opts?: RestDayOpts,
): boolean {
  return uncoveredDatesBetween(fromKey, toKey, recurringDaysOfWeek, oneOffDates, opts).length === 0
}

/** Monday of the week containing `dateKey` (matches Home "this week" and SQL 39). */
export function weekStartMonday(dateKey: string): string {
  const d = parseDateKey(dateKey)
  return localDateKey(addDays(d, -((d.getDay() + 6) % 7)))
}

function datesInWeek(dateKey: string): string[] {
  const start = parseDateKey(weekStartMonday(dateKey))
  return Array.from({ length: 7 }, (_, i) => localDateKey(addDays(start, i)))
}

export function restDaysInWeek(
  dateKey: string,
  recurringDaysOfWeek: Set<number>,
  oneOffDates: Set<string>,
  opts?: RestDayOpts,
): string[] {
  return datesInWeek(dateKey).filter(k => isRestDay(k, recurringDaysOfWeek, oneOffDates, opts))
}

export function restDaysUsedThrough(
  todayKey: string,
  recurringDaysOfWeek: Set<number>,
  oneOffDates: Set<string>,
  opts?: RestDayOpts,
): number {
  return datesInWeek(todayKey).filter(
    k =>
      k <= todayKey &&
      isRestDay(k, recurringDaysOfWeek, oneOffDates, opts) &&
      !opts?.trainedDates?.has(k),
  ).length
}

export type SkipTodayState = {
  todayIsRest: boolean
  todayIsOneOff: boolean
  todayIsScheduled: boolean
  canSkip: boolean
  budget: number
  used: number
}

/**
 * Whether Home can mark `todayKey` as a one-off rest day without exceeding
 * the weekly budget (number of configured rest weekdays). Spent slots are
 * rest days already on or before today — future scheduled days can still
 * be given up by skipping today, but once N days this week are rest, no
 * more skips (and another miss breaks the streak).
 */
export function skipTodayState(
  todayKey: string,
  recurringDaysOfWeek: Set<number>,
  oneOffDates: Set<string>,
  opts?: RestDayOpts,
): SkipTodayState {
  const budget = recurringDaysOfWeek.size
  const todayIsOneOff = oneOffDates.has(todayKey)
  const todayIsRest = isRestDay(todayKey, recurringDaysOfWeek, oneOffDates, opts)
  const todayIsScheduled = todayIsRest && !todayIsOneOff
  const used = restDaysUsedThrough(todayKey, recurringDaysOfWeek, oneOffDates, opts)
  const canSkip = !todayIsRest && budget > 0 && used < budget
  return { todayIsRest, todayIsOneOff, todayIsScheduled, canSkip, budget, used }
}
