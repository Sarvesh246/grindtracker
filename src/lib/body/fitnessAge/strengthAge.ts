import { ANCHOR_LIFE, type Calibration } from './calibration'
import { daysApart, round1, shiftDate, type Confidence } from './cardio'
import { ageForZ, gripZ, liftKind, liftZ, normalCdf, Z80, type LiftKind, type Sex } from './norms'

/**
 * Strength age (docs/FITNESS-AGE-RESEARCH.md §9.3, §10.2). Grip is the
 * health-validated anchor; logged lifts track change between grip readings.
 * Without a grip reading the lifts stand alone against PROVISIONAL norms, with
 * the larger 0.5-SD mapping error the simulation used.
 */

export interface LiftSet {
  date: string
  name: string | null
  /** Canonical lbs. */
  weight: number | null
  reps: number | null
}

export const STRENGTH = {
  windowDays: 42,
  maxReps: 12,
  mapSd: { liftsOnly: 0.5, gripAnchored: 0.2, gripOnly: 0.15 },
  /** Offset drift per 6 months as the anchor ages (§10.3). */
  driftPer182: 0.15,
  sessionNoiseVar: 0.04,
  /** First-months e1RM climbs are mostly technique (novice guard). */
  novice: { historyDays: 120, firstDays: 21, fullGain: 0.25, maxShrink: 0.42 },
} as const

export interface StrengthResult {
  z: number
  age: number
  range: [number, number]
  percentile: number
  confidence: Confidence
  anchorDate: string | null
  lifts: LiftKind[]
}

const e1rm = (w: number, r: number) => (r <= 1 ? w : w * (1 + r / 30))

/** Body weight (lbs) on or before `date`, else the earliest known. */
function weightOn(weights: { date: string; lbs: number }[], date: string): number | null {
  let best: number | null = null
  for (const w of weights) if (w.date <= date) best = w.lbs
  return best ?? weights[0]?.lbs ?? null
}

/** Mean lift z over the window ending `end`, with the novice shrink applied. */
function liftScore(sets: LiftSet[], weights: { date: string; lbs: number }[], sex: Sex, age: number, end: string) {
  const from = shiftDate(end, -STRENGTH.windowDays + 1)
  const n = STRENGTH.novice
  const kinds = new Map<LiftKind, { best: number; date: string; count: number }>()
  for (const s of sets) {
    const kind = liftKind(s.name)
    if (!kind || s.date < from || s.date > end || !(s.weight! > 0) || !(s.reps! >= 1) || s.reps! > STRENGTH.maxReps) continue
    const v = e1rm(s.weight!, s.reps!)
    const cur = kinds.get(kind)
    if (!cur) kinds.set(kind, { best: v, date: s.date, count: 1 })
    else { cur.count++; if (v > cur.best) { cur.best = v; cur.date = s.date } }
  }
  if (!kinds.size) return null
  let sum = 0
  let count = 0
  for (const [kind, k] of kinds) {
    const bw = weightOn(weights, k.date)
    if (!bw) continue
    let z = liftZ(sex, age, kind, k.best / bw)
    const ofKind = sets.filter(s => liftKind(s.name) === kind && s.weight! > 0 && s.reps! >= 1 && s.reps! <= STRENGTH.maxReps && s.date <= end)
    const first = ofKind.reduce((m, s) => (s.date < m ? s.date : m), end)
    if (daysApart(first, end) < n.historyDays) {
      const early = ofKind.filter(s => daysApart(first, s.date) < n.firstDays).map(s => e1rm(s.weight!, s.reps!))
      const gain = early.length ? k.best / Math.max(...early) - 1 : 0
      z -= Math.max(0, Math.min(1, gain / n.fullGain)) * n.maxShrink
    }
    sum += z
    count += k.count
  }
  return count ? { z: sum / kinds.size, sets: count, lifts: [...kinds.keys()] } : null
}

export function strengthAge(input: {
  sex: Sex
  age: number
  today: string
  sets: LiftSet[]
  weights: { date: string; lbs: number }[]
  anchors: Calibration[]
}): StrengthResult | null {
  const { sex, age, today } = input
  const now = liftScore(input.sets, input.weights, sex, age, today)
  const grip = input.anchors.filter(a => a.kind === 'grip' && a.status === 'accepted')
    .sort((a, b) => a.measured_on.localeCompare(b.measured_on)).at(-1)
  if (!now && !grip) return null

  let z: number
  let mapSd: number
  let confidence: Confidence = 'uncalibrated'
  let anchorDate: string | null = null
  if (grip) {
    const old = daysApart(grip.measured_on, today)
    const drift = STRENGTH.driftPer182 * (old / 182)
    const gz = gripZ(sex, age, grip.value)
    const then = liftScore(input.sets, input.weights, sex, age, grip.measured_on)
    if (now && then) {
      z = now.z + (gz - then.z)
      mapSd = Math.min(STRENGTH.mapSd.liftsOnly, Math.hypot(STRENGTH.mapSd.gripAnchored, drift))
    } else if (now) {
      // No lifts around the grip reading: inverse-variance blend of the two.
      const gSd = Math.hypot(STRENGTH.mapSd.gripOnly, drift)
      const wG = 1 / gSd ** 2
      const wL = 1 / STRENGTH.mapSd.liftsOnly ** 2
      z = (gz * wG + now.z * wL) / (wG + wL)
      mapSd = Math.sqrt(1 / (wG + wL))
    } else {
      z = gz
      mapSd = Math.min(STRENGTH.mapSd.liftsOnly, Math.hypot(STRENGTH.mapSd.gripOnly, drift))
    }
    if (old <= ANCHOR_LIFE.grip.half) { confidence = 'calibrated'; anchorDate = grip.measured_on }
  } else {
    z = now!.z
    mapSd = STRENGTH.mapSd.liftsOnly
  }
  let variance = mapSd ** 2 + (now ? STRENGTH.sessionNoiseVar / now.sets : 0)
  // Shrink toward the population mean by the estimate's own uncertainty.
  const w = 1 / (1 + variance)
  z *= w
  variance *= w
  const sd = Math.sqrt(variance)
  return {
    z: Math.round(z * 100) / 100,
    age: round1(ageForZ(age, z)),
    range: [round1(ageForZ(age, z + Z80 * sd)), round1(ageForZ(age, z - Z80 * sd))],
    percentile: Math.round(100 * normalCdf(z)),
    confidence,
    anchorDate,
    lifts: now?.lifts ?? [],
  }
}
