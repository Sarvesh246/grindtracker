import type { DailyRecovery, Night } from './types'

/**
 * How recovered you are this morning compared with YOUR usual, from whatever
 * the watch reported: overnight HRV, Body Battery at wake, resting heart rate.
 *
 * Guardrails, because these are noisy:
 *  - Each reading is compared with your own recent baseline (median / MAD), never a
 *    population norm, and needs 7+ earlier readings before it counts at all.
 *  - Readings are winsorised to ±2 robust z, then AVERAGED. Three sensors agreeing
 *    don't triple the effect; one sensor alone moves it as much as it ever can.
 *  - The result only changes how high the curve sits (as hours of sleep debt
 *    equivalent, capped at ±1.5h). It never moves the clock or the phase times.
 */

export const MIN_BASELINE = 7
const Z_CAP = 2
/** Hours of debt-equivalent per unit z: a z of −2 reads like 1.5h more debt. */
const DEBT_PER_Z = 0.75

export interface RecoveryPart {
  key: 'hrv' | 'body_battery' | 'resting_hr'
  value: number
  usual: number
  /** Positive = better recovered than usual. */
  z: number
}
export interface Recovery {
  z: number
  /** Added to sleep debt: negative when well recovered. */
  debtEquivH: number
  parts: RecoveryPart[]
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Robust z of `value` against `history`; null without enough history. */
export function robustZ(value: number, history: number[]): { z: number; usual: number } | null {
  const clean = history.filter((v) => Number.isFinite(v))
  if (clean.length < MIN_BASELINE || !Number.isFinite(value)) return null
  const usual = median(clean)
  const mad = median(clean.map((v) => Math.abs(v - usual)))
  // A very steady metric has MAD ≈ 0; floor the spread at 5% of usual so a 1-unit wobble isn't "4σ".
  const scale = Math.max(1.4826 * mad, Math.abs(usual) * 0.05, 1e-6)
  const z = Math.max(-Z_CAP, Math.min(Z_CAP, (value - usual) / scale))
  return { z, usual }
}

export function recoveryFor(date: string, nights: Night[], days: DailyRecovery[]): Recovery {
  const parts: RecoveryPart[] = []

  const tonight = nights.find((n) => n.wakeDate === date)
  if (tonight?.hrv != null) {
    const r = robustZ(
      tonight.hrv,
      nights.filter((n) => n.wakeDate < date && n.hrv != null).map((n) => n.hrv as number),
    )
    if (r) parts.push({ key: 'hrv', value: tonight.hrv, usual: r.usual, z: r.z })
  }

  const today = days.find((d) => d.date === date)
  const earlier = days.filter((d) => d.date < date)
  if (today?.bbWake != null) {
    const r = robustZ(today.bbWake, earlier.flatMap((d) => (d.bbWake != null ? [d.bbWake] : [])))
    if (r) parts.push({ key: 'body_battery', value: today.bbWake, usual: r.usual, z: r.z })
  }
  if (today?.restingHr != null) {
    const r = robustZ(today.restingHr, earlier.flatMap((d) => (d.restingHr != null ? [d.restingHr] : [])))
    // A higher resting HR than usual means LESS recovered.
    if (r) parts.push({ key: 'resting_hr', value: today.restingHr, usual: r.usual, z: -r.z })
  }

  if (!parts.length) return { z: 0, debtEquivH: 0, parts }
  const z = parts.reduce((s, p) => s + p.z, 0) / parts.length
  return { z, debtEquivH: -DEBT_PER_Z * z, parts }
}
