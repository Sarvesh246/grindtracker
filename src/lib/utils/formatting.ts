export function formatDayType(dayType: string): string {
  return dayType.charAt(0).toUpperCase() + dayType.slice(1)
}

export function formatShortDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-US', {
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
