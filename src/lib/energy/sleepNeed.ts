import type { Night } from './types'

/** Population median sleep need (RISE's 1.95M users and lab extension studies both land near 8h). */
export const PRIOR_NEED_H = 8
/** How many nights of evidence it takes to pull the estimate halfway off the prior. */
export const PRIOR_WEIGHT = 5
export const MIN_NEED_H = 6
export const MAX_NEED_H = 10

/**
 * Personal sleep need, in hours.
 *
 * Habitual sleep underestimates need: alarms cut nights short. The honest signal
 * is a *rebound* night, one where the body got to sleep as long as it wanted
 * after running up a deficit (Klerman & Dijk 2005; Kitamura 2016). We collect
 * the durations that look like that and shrink them toward the 8h prior, so
 * two weird nights can't swing the whole schedule.
 *
 * `nights` is newest first.
 */
export function sleepNeed(nights: Night[]): number {
  const durations = nights.map((n) => n.sleepH).filter((h) => h > 2 && h < 14)
  if (!durations.length) return PRIOR_NEED_H

  // TODO(human): decide which nights are evidence of need and how much each counts.
  // Build `evidence` as { h: hours slept, w: weight } from `nights` (newest first).
  // The placeholder below (longer half of nights, equal weight) keeps tests green;
  // replace it with a rebound-aware rule.
  const sorted = [...durations].sort((a, b) => a - b)
  const evidence = sorted.slice(Math.floor(sorted.length / 2)).map((h) => ({ h, w: 1 }))

  const totalW = evidence.reduce((s, e) => s + e.w, 0)
  if (totalW <= 0) return PRIOR_NEED_H
  const mean = evidence.reduce((s, e) => s + e.h * e.w, 0) / totalW
  const need = (PRIOR_WEIGHT * PRIOR_NEED_H + totalW * mean) / (PRIOR_WEIGHT + totalW)
  return Math.min(MAX_NEED_H, Math.max(MIN_NEED_H, need))
}
