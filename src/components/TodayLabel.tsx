'use client'
import { useSyncExternalStore } from 'react'
import { formatHeaderDate } from '@/lib/utils/formatting'

/**
 * "SAT, AUG 17" for the VIEWER's local calendar day.
 *
 * Calling `formatHeaderDate()` straight in a page's JSX resolved it in the
 * wrong place. Both Home and Progress render on the server first, so the string
 * came from Vercel's UTC clock: a viewer in UTC-7 was shown TOMORROW's date
 * every evening from 5pm on, and the client's own render then disagreed with
 * the server HTML — a hydration mismatch on top of a plainly wrong date. Same
 * trap `localDateKey` exists to avoid (see Dates & timezones in CLAUDE.md),
 * just applied to a rendered label instead of a stored key.
 *
 * `useSyncExternalStore` is the fix the rest of the app already uses for
 * client-only values (see HomeDashboard's dismiss stores): the server snapshot
 * is null so SSR/prerender emit a non-breaking space placeholder, and the real
 * local date lands on hydration. Re-reads on focus / tab return so a session
 * left open past midnight rolls over, matching HomeDashboard's `todayKey` sync.
 */
function subscribe(cb: () => void): () => void {
  window.addEventListener('focus', cb)
  document.addEventListener('visibilitychange', cb)
  return () => {
    window.removeEventListener('focus', cb)
    document.removeEventListener('visibilitychange', cb)
  }
}

// Returns a plain string: React compares snapshots with Object.is, and equal
// strings are identical, so recomputing per read can't loop.
const getSnapshot = () => formatHeaderDate()
const getServerSnapshot = () => null

export default function TodayLabel({
  style,
  className,
}: {
  style?: React.CSSProperties
  className?: string
}) {
  const label = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  return (
    <span className={className} style={style}>
      {label ?? ' '}
    </span>
  )
}
