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
