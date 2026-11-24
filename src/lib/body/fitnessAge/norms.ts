/**
 * Reference curves for fitness age, ages 18–90 (docs/FITNESS-AGE-RESEARCH.md §3, §9).
 *
 * VO2max: HUNT 3 directly measured decade means (Loe 2013), smoothed so the
 * curve is strictly decreasing (HUNT's men flatten 30–49, which would make the
 * age inversion unstable), shaped above 75 by the FRIEND / Fleg decline and
 * extended to 18 with the gentle youth slope (Kemper 2013, Welde 2020).
 *
 * Grip: Dodds 2014 (12 British studies, ages 4–90) and Tomkinson 2025 (2.4M
 * adults): rises to a peak at 30–39, then declines.
 *
 * PROVISIONAL: the 18–20 VO2 anchors, the 80–90 anchors, the lift norms and the
 * HRV curve are best estimates pending the full-text checks listed in §8/§9.7.
 * They live here, in one place, so tightening them is a data change.
 */

export type Sex = 'male' | 'female'
type Curve = readonly (readonly [number, number])[]

export const MIN_AGE = 18
export const MAX_AGE = 90
/** Midlife between-person SD over age decline: ~20 years per SD for VO2max,
 *  grip and ln-HRV alike (§9.2). */
export const YEARS_PER_SD = 20

export function interp(curve: Curve, x: number): number {
  if (x <= curve[0][0]) return curve[0][1]
  for (let i = 1; i < curve.length; i++) {
    if (x <= curve[i][0]) {
      const [x0, y0] = curve[i - 1]
      const [x1, y1] = curve[i]
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
    }
  }
  return curve[curve.length - 1][1]
}

export const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

const VO2_MEDIAN: Record<Sex, Curve> = {
  male: [[18, 55.8], [25, 54.4], [35, 50.5], [45, 46.6], [55, 42.8], [65, 39.0], [75, 34.8], [90, 28.0]],
  female: [[18, 44.8], [25, 43.0], [35, 40.4], [45, 37.8], [55, 34.4], [65, 31.1], [75, 28.0], [90, 23.0]],
}
const VO2_SD: Record<Sex, Curve> = {
  male: [[18, 8.2], [50, 7.5], [75, 6.5], [90, 6.0]],
  female: [[18, 7.5], [50, 6.0], [75, 5.2], [90, 5.0]],
}

export const vo2Median = (sex: Sex, age: number) => interp(VO2_MEDIAN[sex], age)
export const vo2Sd = (sex: Sex, age: number) => interp(VO2_SD[sex], age)

/** Cardio age: the age at which the reference median equals `vo2`, clamped
 *  to 18–90. At or above the 18-year-old median it is 18 ("at peak"). */
export function ageForVo2(sex: Sex, vo2: number): number {
  if (!Number.isFinite(vo2)) return MAX_AGE
  if (vo2 >= vo2Median(sex, MIN_AGE)) return MIN_AGE
  if (vo2 <= vo2Median(sex, MAX_AGE)) return MAX_AGE
  let lo = MIN_AGE
  let hi = MAX_AGE
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (vo2Median(sex, mid) > vo2) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** The shared z-scale for strength and recovery ages (§9.2). */
export const ageForZ = (age: number, z: number) => clamp(age - YEARS_PER_SD * z, MIN_AGE, MAX_AGE)

// ---- Grip strength (kg, best of 3 per hand, Southampton protocol) ----
const GRIP_MEDIAN: Record<Sex, Curve> = {
  male: [[18, 44], [25, 48], [35, 50], [45, 48.5], [55, 45.5], [65, 41], [75, 35], [85, 29], [90, 26]],
  female: [[18, 28], [25, 30], [35, 31], [45, 30], [55, 27.5], [65, 24.5], [75, 21], [85, 17], [90, 15.5]],
}
const GRIP_SD: Record<Sex, Curve> = {
  male: [[18, 8.5], [60, 8.0], [90, 7.0]],
  female: [[18, 5.5], [60, 5.0], [90, 4.5]],
}
export const gripZ = (sex: Sex, age: number, kg: number) =>
  (kg - interp(GRIP_MEDIAN[sex], age)) / interp(GRIP_SD[sex], age)

// ---- Lifts: estimated 1RM ÷ body weight (PROVISIONAL) ----
// No general-population lift-to-health curves exist (§9.1). These medians are
// for recreationally active adults at peak age; the age shape follows grip.
// The coefficient of variation is ~30%. With a grip anchor the lift numbers
// only track change, so their absolute level stops mattering.
export type LiftKind = 'squat' | 'bench' | 'deadlift' | 'press'
const LIFT_PEAK: Record<Sex, Record<LiftKind, number>> = {
  male: { squat: 1.25, bench: 1.0, deadlift: 1.5, press: 0.65 },
  female: { squat: 0.85, bench: 0.55, deadlift: 1.05, press: 0.4 },
}
const LIFT_CV = 0.3
export function liftZ(sex: Sex, age: number, kind: LiftKind, relative: number): number {
  const ageShape = interp(GRIP_MEDIAN[sex], age) / interp(GRIP_MEDIAN[sex], 35)
  const median = LIFT_PEAK[sex][kind] * ageShape
  return (relative - median) / (median * LIFT_CV)
}

/** Maps a user-named exercise to a reference lift, or null. Variants that
 *  change the load a lot (front squat, incline, sumo is fine) map too; machines
 *  and single-arm work do not. */
export function liftKind(name: string | null | undefined): LiftKind | null {
  if (!name) return null
  const n = name.toLowerCase()
  if (/machine|smith|leg press|single|one[- ]arm|dumbbell|\bdb\b|goblet|split|bulgarian|hack/.test(n)) return null
  if (/dead ?lift|\brdl\b|romanian/.test(n)) return /romanian|\brdl\b|stiff/.test(n) ? null : 'deadlift'
  if (/squat/.test(n)) return 'squat'
  if (/bench/.test(n)) return 'bench'
  if (/overhead press|\bohp\b|military|shoulder press|strict press/.test(n)) return 'press'
  return null
}

// ---- Recovery: overnight resting HR and ln(HRV) ----
export const RHR_MEAN: Record<Sex, number> = { male: 60, female: 64 }
export const RHR_SD = 9
/** PROVISIONAL: overnight RMSSD falls ~1.8%/year from ~58 ms (men) / 54 ms
 *  (women) at 20. Garmin-specific norms are still to be confirmed (§9.7). */
export const lnHrvMean = (sex: Sex, age: number) => Math.log(sex === 'male' ? 58 : 54) - 0.018 * (age - 20)
export const LN_HRV_SD = 0.435

// ---- GRIND age weights (§9.3), renormalised over the scores that exist ----
export const WEIGHTS = { cardio: 0.55, strength: 0.3, recovery: 0.15 } as const

/** Standard normal CDF (Zelen & Severo), for percentiles. */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const d = 0.3989423 * Math.exp((-z * z) / 2)
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  return z > 0 ? 1 - p : p
}

export const Z80 = 1.2816
