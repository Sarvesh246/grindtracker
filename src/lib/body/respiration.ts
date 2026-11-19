import { daysBetween } from './load'
import type { DailyBody } from './types'

/**
 * Resting respiration from the watch's live respiration rate (migration 71's
 * resp_series): one reading per 15-min bucket a snapshot was taken in.
 *
 * Overnight is midnight to 06:00 (buckets 0–23), when you're asleep or still,
 * so the median of those readings is a resting rate and a stray
 * awake reading doesn't move it. Fewer than OVERNIGHT_MIN readings (2 h of
 * snapshots) is no reading at all: a watch charged overnight would otherwise
 * produce a "resting" rate from the morning walk to the car.
 */

const OVERNIGHT_BUCKETS = 24
const OVERNIGHT_MIN = 8
const MIN_BASELINE_NIGHTS = 5

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** The night's resting respiration, breaths per minute, or null. */
export function restingRespiration(row: Pick<DailyBody, 'resp_series'> | null | undefined): number | null {
  const night = (row?.resp_series ?? []).slice(0, OVERNIGHT_BUCKETS).filter((v): v is number => v != null)
  return night.length >= OVERNIGHT_MIN ? median(night) : null
}

/** Mean resting respiration over the 30 nights before `today`, or null with
 *  fewer than five. */
export function respirationBaseline(days: DailyBody[], today: string): number | null {
  const vals = days
    .filter(d => d.local_date < today && daysBetween(d.local_date, today) <= 30)
    .map(restingRespiration)
    .filter((v): v is number => v != null)
  if (vals.length < MIN_BASELINE_NIGHTS) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}
