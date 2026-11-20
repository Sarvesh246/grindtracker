import { localToIso, validZone } from '@/lib/health/importers'
import { localDateIn } from '@/lib/health/reconcile'
import { shiftDate } from '@/lib/health/model'

/**
 * The energy model thinks in "clock hours relative to a local day": 7.5 is
 * 07:30 on `date`, -1 is 23:00 the evening before, 26 is 02:00 the next day.
 * These helpers convert between that and real instants in an IANA zone, using
 * wall-clock arithmetic so a DST night still reads 23:00 → 07:00 as 8 hours of
 * clock, not 7 or 9.
 */

function wallParts(ms: number, zone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms))
  const p = (t: string) => Number(parts.find((x) => x.type === t)?.value ?? 0)
  return { y: p('year'), mo: p('month'), d: p('day'), h: p('hour'), mi: p('minute'), s: p('second') }
}

/** Local clock hours of `iso` measured from midnight of `date` in `zone`. */
export function clockHoursFrom(date: string, iso: string, zone: string): number {
  const w = wallParts(Date.parse(iso), zone)
  const [y, m, d] = date.split('-').map(Number)
  const dayDiff = Math.round((Date.UTC(w.y, w.mo - 1, w.d) - Date.UTC(y, m - 1, d)) / 86_400_000)
  return dayDiff * 24 + w.h + w.mi / 60 + w.s / 3600
}

/** The instant that reads `hours` on the local clock relative to `date` (inverse of clockHoursFrom). */
export function instantAt(date: string, hours: number, zone: string): string {
  const dayShift = Math.floor(hours / 24)
  const rest = hours - dayShift * 24
  const totalMin = Math.round(rest * 60)
  const hh = Math.floor(totalMin / 60)
  const mm = totalMin % 60
  const day = dayShift ? shiftDate(date, dayShift) : date
  const text = `${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`
  return localToIso(text, zone) ?? `${text}Z`
}

/** Today's YYYY-MM-DD in `zone`. */
export function todayIn(zone: string, now: Date = new Date()): string {
  return localDateIn(now.toISOString(), zone)
}

export { validZone }
