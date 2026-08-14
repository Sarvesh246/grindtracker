const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

const DOW_NAMES = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const

const DOW_SHORT: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  tues: 2,
  wed: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  fri: 5,
  sat: 6,
}

/** Validate a YYYY-MM-DD civil date (no timezone, no ±day skew). */
export function parseCalendarDateKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  const match = LOCAL_DATE_RE.exec(s)
  if (!match) return null
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== m - 1 ||
    probe.getUTCDate() !== d
  ) {
    return null
  }
  return s
}

/** Weekday of a YYYY-MM-DD key (0=Sun..6=Sat), calendar-based. */
export function dayOfWeekFromDateKey(key: string): number {
  const parsed = parseCalendarDateKey(key)
  if (!parsed) return -1
  const [y, m, d] = parsed.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d, 12, 0, 0)).getUTCDay()
}

export const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/**
 * Parse 0–6 or a weekday name ("Sunday", "sun", "Thu").
 */
export function parseDayOfWeek(raw: string | number): number | null {
  if (typeof raw === 'number') {
    const n = Math.round(raw)
    return n >= 0 && n <= 6 ? n : null
  }
  const s = raw.trim().toLowerCase()
  if (!s) return null
  if (/^[0-6]$/.test(s)) return Number(s)
  const full = DOW_NAMES.indexOf(s as (typeof DOW_NAMES)[number])
  if (full >= 0) return full
  const short = DOW_SHORT[s.slice(0, 4)] ?? DOW_SHORT[s.slice(0, 3)]
  return short === undefined ? null : short
}

export function hourInTimeZone(
  iso: string,
  timeZone: string | null,
): number | null {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return null
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'UTC',
      hour: 'numeric',
      hourCycle: 'h23',
    })
    const hour = Number(fmt.format(date))
    return Number.isFinite(hour) ? hour : null
  } catch {
    return null
  }
}
