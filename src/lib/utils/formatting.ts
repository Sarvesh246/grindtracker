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
