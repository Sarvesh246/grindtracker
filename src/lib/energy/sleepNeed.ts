import { isPlausibleSleep, sleepDebt } from './model'
import type { Night } from './types'

/**
 * Personal sleep need, in hours, from the user's own nights. Sources and the
 * reasoning behind every constant are in docs/ENERGY.md ("Sleep need").
 */

/** Population median need: RISE's ~2M users; lab extension studies land at 8.4h (Kitamura 2016). */
const PRIOR_NEED_H = 8
/** Nights of evidence it takes to pull the estimate halfway off the prior. */
const PRIOR_WEIGHT = 5
const MIN_NEED_H = 6
const MAX_NEED_H = 10

/**
 * Share of carried-in debt a free night repays. Kitamura 2016: with unlimited
 * sleep opportunity, 1h of debt took ~4 nights to clear, i.e. about a quarter of
 * what remains comes back per night.
 */
const REPAY_PER_NIGHT = 0.25
/**
 * A night this much LONGER than your usual reads as one nothing cut short. Duration,
 * not wake time: MCTQ defines free days by oversleep (Roenneberg), and a shifted
 * schedule (asleep 05:00, up 12:30) wakes late without sleeping longer.
 */
const FREE_EXTRA_H = 0.5
/** Nights older than this count half as much: need is a trait, but people change. */
const HALF_LIFE_NIGHTS = 14

function weightedMedian(items: { v: number; w: number }[]): number {
  const sorted = [...items].sort((a, b) => a.v - b.v)
  const half = sorted.reduce((s, x) => s + x.w, 0) / 2
  let acc = 0
  for (const x of sorted) {
    acc += x.w
    if (acc >= half) return x.v
  }
  return sorted[sorted.length - 1].v
}

/** Debt carried INTO each night (hours): the running balance of the 14 nights before it. */
function carriedDebt(nights: Night[], need: number): number[] {
  return nights.map((_, i) => sleepDebt(nights.slice(i + 1), need))
}

/**
 * Two corrections turn raw nights into evidence of need:
 *
 *  1. Rebound correction. A free morning after short nights includes catch-up
 *     on top of need, so implied need = slept − REPAY_PER_NIGHT × debt carried in.
 *  2. Censoring. A night no longer than usual may have been cut by an alarm, so
 *     it only says "need ≥ this". It counts fully when it sits above the current
 *     estimate (that is information) and only lightly below it (it might be an
 *     alarm, not the body). A clearly long night ran its course and counts fully.
 *
 * Evidence is combined with a weighted median (robust to a sick day or a
 * tracking glitch), then shrunk toward the 8h prior. Two passes, because the
 * debt in step 1 depends on the need being estimated.
 */
export function sleepNeed(nights: Night[]): number {
  const valid = nights.filter((n) => isPlausibleSleep(n.sleepH))
  if (!valid.length) return PRIOR_NEED_H
  const usualSleep = weightedMedian(valid.map((n) => ({ v: n.sleepH, w: 1 })))

  let need = PRIOR_NEED_H
  for (let pass = 0; pass < 2; pass++) {
    const debt = carriedDebt(valid, need)
    const evidence = valid.map((n, i) => {
      const free = n.sleepH >= usualSleep + FREE_EXTRA_H
      // Only a free morning contains catch-up; an alarm-cut night is just a floor.
      const implied = free ? n.sleepH - REPAY_PER_NIGHT * debt[i] : n.sleepH
      const censorW = free || implied >= need ? 1 : 0.25
      const fragmentW = (n.pieces ?? 1) > 1 ? 0.5 : 1
      const recencyW = Math.pow(0.5, i / HALF_LIFE_NIGHTS)
      return { v: implied, w: censorW * fragmentW * recencyW }
    })
    const totalW = evidence.reduce((s, e) => s + e.w, 0)
    if (totalW <= 0) return PRIOR_NEED_H
    const centre = weightedMedian(evidence)
    need = (PRIOR_WEIGHT * PRIOR_NEED_H + totalW * centre) / (PRIOR_WEIGHT + totalW)
    need = Math.min(MAX_NEED_H, Math.max(MIN_NEED_H, need))
  }
  return need
}
