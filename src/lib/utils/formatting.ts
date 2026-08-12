export function formatDayType(dayType: string): string {
  return dayType.charAt(0).toUpperCase() + dayType.slice(1)
}

export function formatShortDate(date: string | Date): string {
  // A bare 'YYYY-MM-DD' string parses as UTC midnight, which shifts the
  // calendar day backward for any timezone behind UTC (the same trap
  // localDateKey exists to avoid) — anchor it at local noon like the rest
  // of the codebase does for stored date keys. Full timestamps (the current
  // caller passes `completed_at`) already carry a time component and skip
  // this branch, so behavior there is unchanged.
  const d = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? new Date(date + 'T12:00:00')
    : new Date(date)
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).toUpperCase()
}

export function formatHeaderDate(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).toUpperCase()
}

/**
 * Local-timezone date key (YYYY-MM-DD). Unlike `toISOString().split('T')[0]`,
 * this never shifts the calendar day for users ahead of/behind UTC, so streak
 * dates stay consistent with the user's actual local day.
 */
export function localDateKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * Validate a client-supplied YYYY-MM-DD calendar key (no timezone shift).
 * Rejects impossible months/days. Optional ±daySkew vs UTC "today" guards
 * against garbage / clock-skew abuse without requiring the server TZ.
 */
export function parseClientLocalDate(
  raw: unknown,
  opts?: { now?: Date; daySkew?: number },
): string | null {
  if (typeof raw !== 'string' || !LOCAL_DATE_RE.test(raw)) return null
  const match = LOCAL_DATE_RE.exec(raw)
  if (!match) return null
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  // Use UTC noon components only for calendar validity — not for "today".
  const probe = new Date(Date.UTC(y, m - 1, d))
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== m - 1 ||
    probe.getUTCDate() !== d
  ) {
    return null
  }
  const skew = opts?.daySkew ?? 2
  const now = opts?.now ?? new Date()
  const utcToday = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  )
  const clientDay = Date.UTC(y, m - 1, d)
  const diffDays = Math.abs(clientDay - utcToday) / 86_400_000
  if (diffDays > skew) return null
  return raw
}

/** YYYY-MM-DD for an IANA time zone at `date` (defaults to now). */
export function localDateKeyInTimeZone(
  timeZone: string,
  date: Date = new Date(),
): string | null {
  if (!timeZone || typeof timeZone !== 'string' || timeZone.length > 64) {
    return null
  }
  try {
    const formatted = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date)
    return parseClientLocalDate(formatted, { now: date, daySkew: 2 })
  } catch {
    return null
  }
}
