import type { HrSet } from './types'

/**
 * "Getting fitter": the same exercise at a similar weight and reps, compared
 * by peak heart rate across time. Wrist HR is noisy during lifts, so this only
 * speaks with at least MIN_SETS comparable sets on each side and a difference
 * of at least MIN_DELTA bpm.
 */

export const MIN_SETS = 3
export const MIN_DELTA = 3
const WEIGHT_TOLERANCE = 0.05
const REPS_TOLERANCE = 2

export interface FitterLine {
  /** Positive = easier now (lower peak HR). */
  deltaBpm: number
  weight: number
  reps: number
  then: string
  sentence: string
  /** "185 lbs × 8" */
  label: string
  recentAvg: number
  earlierAvg: number
}

export interface DatedHrSet extends HrSet {
  /** YYYY-MM-DD of the session. */
  local_date: string
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function monthName(key: string): string {
  return new Date(`${key}T12:00:00`).toLocaleDateString('en-US', { month: 'long' })
}

/**
 * Anchors on the most recent set with HR and compares sets within tolerance of
 * it: the latest MIN_SETS against everything at least 21 days older.
 * `fmtWeight` turns canonical lbs into a display string ("185 lbs").
 */
export function fitterLine(sets: DatedHrSet[], fmtWeight: (lbs: number) => string = w => `${w}`): FitterLine | null {
  const withHr = sets
    .filter(s => s.hr_peak != null && s.weight != null && s.weight > 0 && s.reps != null && s.reps > 0)
    .sort((a, b) => (a.local_date < b.local_date ? 1 : a.local_date > b.local_date ? -1 : 0))
  if (withHr.length < MIN_SETS * 2) return null

  const anchor = withHr[0]
  const similar = withHr.filter(
    s =>
      Math.abs((s.weight as number) - (anchor.weight as number)) <= (anchor.weight as number) * WEIGHT_TOLERANCE &&
      Math.abs((s.reps as number) - (anchor.reps as number)) <= REPS_TOLERANCE,
  )
  const recent = similar.slice(0, MIN_SETS)
  if (recent.length < MIN_SETS) return null
  const cutoff = new Date(`${recent[recent.length - 1].local_date}T12:00:00`)
  cutoff.setDate(cutoff.getDate() - 21)
  const earlier = similar.filter(s => new Date(`${s.local_date}T12:00:00`) <= cutoff)
  if (earlier.length < MIN_SETS) return null

  const recentAvg = median(recent.map(s => s.hr_peak as number))
  const earlierAvg = median(earlier.map(s => s.hr_peak as number))
  const deltaBpm = Math.round(earlierAvg - recentAvg)
  if (Math.abs(deltaBpm) < MIN_DELTA) return null

  const then = monthName(earlier[0].local_date)
  const sentence =
    deltaBpm > 0
      ? `Same weight, ${deltaBpm} bpm easier than ${then}.`
      : `Same weight, ${-deltaBpm} bpm harder than ${then}. Could be fatigue, sleep or stress.`
  return {
    deltaBpm,
    weight: anchor.weight as number,
    reps: anchor.reps as number,
    then,
    sentence,
    label: `${fmtWeight(anchor.weight as number)} × ${anchor.reps}`,
    recentAvg,
    earlierAvg,
  }
}
