import { localDateKey } from './formatting'

/**
 * Rest-day helpers — pure, framework-agnostic (no Supabase import), same style
 * as rotation.ts. Mirrors the SQL connectivity semantics in
 * docs/sql/14-rest-days.sql exactly, so the client can reason about streak
 * gaps using the viewer's own local "today" (never the server's — see Dates &
 * timezones in CLAUDE.md).
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

/** True if `dateKey` is a rest day: its weekday is in the recurring set
 *  (0=Sun..6=Sat — Date.getDay() already matches Postgres's extract(dow), no
 *  translation needed), or it's one of the user's one-off confirmed rest
 *  dates. */
export function isRestDay(
  dateKey: string,
  recurringDaysOfWeek: Set<number>,
  oneOffDates: Set<string>,
): boolean {
  if (oneOffDates.has(dateKey)) return true
  return recurringDaysOfWeek.has(parseDateKey(dateKey).getDay())
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
): string[] {
  const a = parseDateKey(fromKey)
  const b = parseDateKey(toKey)
  const start = a.getTime() <= b.getTime() ? a : b
  const end = a.getTime() <= b.getTime() ? b : a

  const uncovered: string[] = []
  let cursor = addDays(start, 1)
  while (cursor.getTime() < end.getTime()) {
    const key = localDateKey(cursor)
    if (!isRestDay(key, recurringDaysOfWeek, oneOffDates)) uncovered.push(key)
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
): boolean {
  return uncoveredDatesBetween(fromKey, toKey, recurringDaysOfWeek, oneOffDates).length === 0
}
