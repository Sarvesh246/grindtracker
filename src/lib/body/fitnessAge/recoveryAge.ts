import { round1, shiftDate, type FitnessDay, type NightFlags } from './cardio'
import { ageForZ, LN_HRV_SD, lnHrvMean, normalCdf, RHR_MEAN, RHR_SD, Z80, type Sex } from './norms'

/**
 * Recovery age (docs/FITNESS-AGE-RESEARCH.md §9.3): 28-night medians of
 * overnight resting HR and ln(HRV) against age/sex norms, skipping sick /
 * alcohol nights. If fewer than 10 clean nights remain, every night counts:
 * a blank score is worse than a slightly noisy one (stress-test fix 2).
 * Precise, but the weakest link to health outcomes, so the smallest weight.
 */

export const RECOVERY = { windowDays: 28, minNights: 10, sd: 0.25 / 0.8 * 0.5 + 0.08 } as const

export interface RecoveryResult {
  z: number
  age: number
  range: [number, number]
  percentile: number
  restingHr: number
  hrvMs: number
  nights: number
}

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function recoveryAge(input: { sex: Sex; age: number; today: string; days: FitnessDay[]; flags: NightFlags }): RecoveryResult | null {
  const { sex, age, today } = input
  const from = shiftDate(today, -RECOVERY.windowDays + 1)
  const nights = input.days.filter(d => d.date >= from && d.date <= today && d.rhr != null && d.hrv != null && d.hrv > 0)
  let keep = nights.filter(d => !input.flags.flagged.has(d.date))
  if (keep.length < RECOVERY.minNights) keep = nights
  if (keep.length < RECOVERY.minNights) return null
  const rhr = median(keep.map(d => d.rhr!))
  const lnHrv = median(keep.map(d => Math.log(d.hrv!)))
  const z = (0.5 * (-(rhr - RHR_MEAN[sex]) / RHR_SD) + 0.5 * ((lnHrv - lnHrvMean(sex, age)) / LN_HRV_SD)) / 0.8
  return {
    z: Math.round(z * 100) / 100,
    age: round1(ageForZ(age, z)),
    range: [round1(ageForZ(age, z + Z80 * RECOVERY.sd)), round1(ageForZ(age, z - Z80 * RECOVERY.sd))],
    percentile: Math.round(100 * normalCdf(z)),
    restingHr: Math.round(rhr),
    hrvMs: Math.round(Math.exp(lnHrv)),
    nights: keep.length,
  }
}
