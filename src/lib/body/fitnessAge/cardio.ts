import { ANCHOR_LIFE, type Calibration } from './calibration'
import { ageForVo2, normalCdf, RHR_MEAN, vo2Median, vo2Sd, Z80, type Sex } from './norms'

/**
 * Cardio age (docs/FITNESS-AGE-RESEARCH.md §5, §9.3): a two-state Kalman
 * filter over [true VO2max, the person's Garmin bias], run day by day over the
 * history window, then inverted through the reference curve.
 *
 * Every constant below is the one the 54,000-person simulation was tuned and
 * stress-tested with (scripts/fitness-age-sim.mjs, CONFIGS.final).
 */

export interface FitnessDay {
  date: string
  /** Garmin VO2max reading that day (mL/kg/min), if any. */
  vo2?: number | null
  /** Overnight resting HR, bpm. */
  rhr?: number | null
  /** Overnight HRV, ms. */
  hrv?: number | null
  weightKg?: number | null
  /** A run, ride or other vigorous session that day. */
  active?: boolean
  /** Tagged sick / alcohol (body_signal_labels). */
  tagged?: boolean
}

export const CARDIO = {
  /** Garmin under-reads high and over-reads low VO2max (Düking 2022, Engel 2025). */
  pullToMean: 0.12,
  pullCentre: 50,
  biasSd: { running: 2.6, cycling: 3.5 },
  readingSd: { running: 1.5, cycling: 2.0 },
  /** Garmin smooths its own estimate: take one reading a week. */
  readingEveryDays: 7,
  /** Day-to-day true-VO2 drift variance (≈1.2 mL/kg/min over 30 days). */
  driftVar: 0.05,
  /** Bias drift: ~1 mL/kg/min per 6 months, so anchors fade (§10.3). */
  biasDriftVar: 1 / 182,
  /** Detraining: −0.15%/day after 21 days off a ≥ 6-in-60-days habit, ≤ 12%. */
  detrain: { gapDays: 21, habitRuns: 6, habitWindow: 60, perDay: 0.0015, floor: 0.88 },
  /** Non-exercise prior: Fenland RHR slope, FRIEND body-mass slope. */
  prior: { rhrSlope: 0.27, kgSlope: 0.33, refBmi: 22.5, sd: 6.5 },
  gate: { rhrUp: 1.05, hrvDown: Math.log(0.9), window: 28, minNights: 7 },
} as const

export type Sport = 'running' | 'cycling'

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function shiftDate(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00`)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const daysApart = (a: string, b: string) =>
  Math.round((new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / 86_400_000)

export interface NightFlags {
  flagged: Set<string>
  /** Rolling baselines on each date (median of the last 28 unflagged nights). */
  rhrBase: Map<string, number>
  lnHrvBase: Map<string, number>
}

/** Sick / alcohol nights: tagged, or RHR ≥ +5% / HRV ≤ −10% vs the rolling
 *  baseline of unflagged nights (Altini & Plews 2021). */
export function flagNights(days: FitnessDay[]): NightFlags {
  const flagged = new Set<string>()
  const rhrBase = new Map<string, number>()
  const lnHrvBase = new Map<string, number>()
  const rhrWin: number[] = []
  const hrvWin: number[] = []
  for (const d of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    const rb = rhrWin.length >= CARDIO.gate.minNights ? median(rhrWin) : null
    const hb = hrvWin.length >= CARDIO.gate.minNights ? median(hrvWin) : null
    if (rb != null) rhrBase.set(d.date, rb)
    if (hb != null) lnHrvBase.set(d.date, hb)
    const ln = d.hrv != null && d.hrv > 0 ? Math.log(d.hrv) : null
    const off = d.tagged
      || (rb != null && d.rhr != null && d.rhr > rb * CARDIO.gate.rhrUp)
      || (hb != null && ln != null && ln < hb + CARDIO.gate.hrvDown)
    if (off) { flagged.add(d.date); continue }
    if (d.rhr != null) { rhrWin.push(d.rhr); if (rhrWin.length > CARDIO.gate.window) rhrWin.shift() }
    if (ln != null) { hrvWin.push(ln); if (hrvWin.length > CARDIO.gate.window) hrvWin.shift() }
  }
  return { flagged, rhrBase, lnHrvBase }
}

type Mat = [[number, number], [number, number]]

function update(x: [number, number], P: Mat, H: [number, number], y: number, R: number) {
  const PH: [number, number] = [P[0][0] * H[0] + P[0][1] * H[1], P[1][0] * H[0] + P[1][1] * H[1]]
  const S = H[0] * PH[0] + H[1] * PH[1] + R
  const K: [number, number] = [PH[0] / S, PH[1] / S]
  const innovation = y - (H[0] * x[0] + H[1] * x[1])
  x[0] += K[0] * innovation
  x[1] += K[1] * innovation
  const p00 = P[0][0] - K[0] * PH[0]
  const p01 = P[0][1] - K[0] * PH[1]
  const p11 = P[1][1] - K[1] * PH[1]
  P[0][0] = p00; P[0][1] = p01; P[1][0] = p01; P[1][1] = p11
}

export type Confidence = 'uncalibrated' | 'calibrated' | 'lab-verified'

export interface CardioResult {
  vo2: number
  vo2Sd: number
  age: number
  range: [number, number]
  /** Fitter than the average 18-year-old: the age sits at the floor. */
  atPeak: boolean
  /** Percentile against your own age and sex. */
  percentile: number
  confidence: Confidence
  anchorDate: string | null
  readingsUsed: number
  /** Garmin's personal bias as learnt so far (reading − true), mL/kg/min. */
  garminBias: number
  /** A first anchor more than 2 error SDs from the estimate before it (§10.4). */
  surprise: { date: string; garminReadsHigh: boolean; by: number } | null
}

export interface CardioInput {
  sex: Sex
  age: number
  heightCm?: number | null
  sport: Sport
  today: string
  days: FitnessDay[]
  anchors: Calibration[]
  flags?: NightFlags
}

/** Null without any reading, resting HR or anchor to start from. */
export function cardioAge(input: CardioInput): CardioResult | null {
  const { sex, age, sport, today } = input
  const days = [...input.days].sort((a, b) => a.date.localeCompare(b.date))
  const anchors = input.anchors.filter(a => a.kind !== 'grip').sort((a, b) => a.measured_on.localeCompare(b.measured_on))
  if (!days.length && !anchors.length) return null
  const byDate = new Map(days.map(d => [d.date, d]))
  const anchorsOn = new Map<string, Calibration[]>()
  for (const a of anchors) anchorsOn.set(a.measured_on, [...(anchorsOn.get(a.measured_on) ?? []), a])
  const flags = input.flags ?? flagNights(days)

  const hasReading = days.some(d => d.vo2 != null)
  const rhrs = days.slice(0, 28).map(d => d.rhr).filter((v): v is number => v != null)
  if (!hasReading && !anchors.length && rhrs.length < 7) return null

  // Prior: population, sharpened by resting HR and body mass where known.
  const k = CARDIO.prior
  let prior = vo2Median(sex, age)
  let priorVar = vo2Sd(sex, age) ** 2
  if (rhrs.length >= 7) {
    prior += k.rhrSlope * (RHR_MEAN[sex] - median(rhrs))
    const w = days.map(d => d.weightKg).find((v): v is number => v != null)
    if (w != null && input.heightCm) prior -= k.kgSlope * (w - k.refBmi * (input.heightCm / 100) ** 2)
    priorVar = k.sd ** 2
  }
  const x: [number, number] = [prior, 0]
  const P: Mat = [[priorVar, 0], [0, CARDIO.biasSd[sport] ** 2]]

  const pull = CARDIO.pullToMean
  const Rg = (CARDIO.readingSd[sport] / (1 - pull)) ** 2
  const start = [days[0]?.date, anchors[0]?.measured_on].filter(Boolean).sort()[0]!
  let lastWeight: number | null = null
  let lastTaken = -Infinity
  let lastActive: number | null = null
  let decay = 1
  let readingsUsed = 0
  let surprise: CardioResult['surprise'] = null
  let anchored = false
  const activeDays: number[] = []

  for (let i = 0, date = start; date <= today; i++, date = shiftDate(date, 1)) {
    const d = byDate.get(date)
    // Predict. Fat loss leaves absolute VO2 alone, so mL/kg rises with it.
    if (d?.weightKg != null) {
      if (lastWeight != null) { const r = lastWeight / d.weightKg; x[0] *= r; P[0][0] *= r * r }
      lastWeight = d.weightKg
    }
    P[0][0] += CARDIO.driftVar
    P[1][1] += CARDIO.biasDriftVar
    if (d?.active) { activeDays.push(i); lastActive = i }
    const dt = CARDIO.detrain
    if (lastActive != null && i - lastActive > dt.gapDays) {
      const habit = activeDays.filter(t => t >= lastActive! - dt.habitWindow && t <= lastActive!).length
      if (habit >= dt.habitRuns && decay > dt.floor) { x[0] *= 1 - dt.perDay; decay *= 1 - dt.perDay }
    } else decay = 1

    if (d?.vo2 != null && !flags.flagged.has(date) && i - lastTaken >= CARDIO.readingEveryDays) {
      const y = (d.vo2 - CARDIO.pullCentre * pull) / (1 - pull)
      update(x, P, [1, 1 / (1 - pull)], y, Rg)
      lastTaken = i
      readingsUsed++
    }
    for (const a of anchorsOn.get(date) ?? []) {
      const sd = a.sd ?? 2.5
      if (!anchored && Math.abs(a.value - x[0]) > 2 * Math.sqrt(P[0][0] + sd * sd) && readingsUsed > 0) {
        surprise = { date, garminReadsHigh: x[0] > a.value, by: Math.round(Math.abs(x[0] - a.value) * 10) / 10 }
      }
      update(x, P, [1, 0], a.value, sd * sd)
      anchored = true
    }
  }

  const vo2 = x[0]
  const sd = Math.sqrt(Math.max(P[0][0], 0.01))
  const lastLab = anchors.filter(a => a.kind === 'lab_cpet').at(-1)
  const lastField = anchors.filter(a => a.kind !== 'lab_cpet').at(-1)
  let confidence: Confidence = 'uncalibrated'
  let anchorDate: string | null = null
  if (lastLab && daysApart(lastLab.measured_on, today) <= ANCHOR_LIFE.lab.half) {
    confidence = 'lab-verified'; anchorDate = lastLab.measured_on
  } else if (lastField && daysApart(lastField.measured_on, today) <= ANCHOR_LIFE.field.half) {
    confidence = 'calibrated'; anchorDate = lastField.measured_on
  }
  const fitnessAge = ageForVo2(sex, vo2)
  return {
    vo2: round1(vo2),
    vo2Sd: round1(sd),
    age: round1(fitnessAge),
    range: [round1(ageForVo2(sex, vo2 + Z80 * sd)), round1(ageForVo2(sex, vo2 - Z80 * sd))],
    atPeak: fitnessAge <= 18,
    percentile: Math.round(100 * normalCdf((vo2 - vo2Median(sex, age)) / vo2Sd(sex, age))),
    confidence,
    anchorDate,
    readingsUsed,
    garminBias: round1(x[1]),
    surprise,
  }
}

export const round1 = (v: number) => Math.round(v * 10) / 10
