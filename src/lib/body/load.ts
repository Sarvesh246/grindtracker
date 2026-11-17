import type { LoadSession } from './types'

/**
 * Training load: minutes weighted by heart-rate zone (zone 1 counts 1x, zone 5
 * counts 5x), the same idea as Edwards' TRIMP. A session without a heart-rate
 * trace (logged on the web) counts as zone-2 effort for its duration, so mixing
 * web and watch workouts doesn't make a week look artificially easy.
 */

const ZONE_WEIGHTS = [1, 2, 3, 4, 5]
/** Longer than this is a session left open by accident, not a workout. */
const MAX_FALLBACK_MINUTES = 150

export function sessionLoad(s: LoadSession): number {
  if (s.zone_seconds && s.zone_seconds.length === 5) {
    const total = s.zone_seconds.reduce((sum, secs, i) => sum + (secs / 60) * ZONE_WEIGHTS[i], 0)
    if (total > 0) return total
  }
  if (!s.started_at || !s.completed_at) return 0
  const minutes = (Date.parse(s.completed_at) - Date.parse(s.started_at)) / 60_000
  if (!(minutes > 0)) return 0
  return Math.min(minutes, MAX_FALLBACK_MINUTES) * 2
}

/** Whole days from `from` to `to`, both YYYY-MM-DD (parsed at local noon). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00`) - Date.parse(`${from}T12:00:00`)) / 86_400_000)
}

export type LoadBand = 'low' | 'building' | 'high'

export interface LoadBalance {
  /** Load over the last 7 days, today included. */
  acute: number
  /** Average weekly load over the last 28 days. */
  chronicWeekly: number
  /** acute / chronicWeekly; 0.8–1.3 is the sweet spot. */
  ratio: number
  band: LoadBand
  /** acute vs chronic as a signed percentage, e.g. +12. */
  percent: number
  headline: string
  sentence: string
}

export const SWEET_SPOT: readonly [number, number] = [0.8, 1.3]

/**
 * Last 7 days against the 28-day weekly average. Needs at least two weeks of
 * history with some training in it, or the ratio is noise.
 */
export function loadBalance(sessions: LoadSession[], today: string): LoadBalance | null {
  let acute = 0
  let chronic = 0
  let oldest = 0
  for (const s of sessions) {
    if (!s.local_date || !s.completed_at) continue
    const age = daysBetween(s.local_date, today)
    if (age < 0 || age >= 28) continue
    const load = sessionLoad(s)
    chronic += load
    if (age < 7) acute += load
    oldest = Math.max(oldest, age)
  }
  if (oldest < 14 || chronic <= 0) return null
  const chronicWeekly = chronic / 4
  const ratio = acute / chronicWeekly
  const percent = Math.round((ratio - 1) * 100)
  const band: LoadBand = ratio < SWEET_SPOT[0] ? 'low' : ratio > SWEET_SPOT[1] ? 'high' : 'building'
  const more = `${Math.abs(percent)}% ${percent >= 0 ? 'more' : 'less'} than your monthly average`
  const headline = band === 'low' ? 'Easing off' : band === 'high' ? 'Running hot' : 'Building well'
  const sentence =
    band === 'low'
      ? `You're doing ${more}. Fine for a deload; stay here too long and strength stalls.`
      : band === 'high'
        ? `You're doing ${more}. Ramping this fast is when people get hurt or stall. Ease off for a few days.`
        : `You're doing ${more}. That's the range where strength builds without wearing you down.`
  return { acute, chronicWeekly, ratio, band, percent, headline, sentence }
}

/** Score 0–100 for Charge: full marks inside the sweet spot, falling off either side. */
export function loadScore(ratio: number): number {
  if (ratio >= SWEET_SPOT[0] && ratio <= SWEET_SPOT[1]) return 100
  if (ratio < SWEET_SPOT[0]) return clamp(100 - (SWEET_SPOT[0] - ratio) * 125, 0, 100)
  return clamp(100 - (ratio - SWEET_SPOT[1]) * 200, 0, 100)
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
