import { hrvScore, summarizeReadiness, type ReadinessCheck, type ReadinessSummary } from './hrv'
import { clamp, daysBetween, loadBalance, loadScore } from './load'
import { respirationBaseline, restingRespiration } from './respiration'
import { strengthLoad, strengthScore, type RecoverySignals, type StrengthLoad, type StrengthSet } from './strength'
import type { DailyBody, LoadSession } from './types'

/**
 * Charge: how ready you are to train today, 0–100, with its working shown.
 *
 *   Body Battery morning peak   30%   the value itself
 *   HRV check vs your usual     20%   at or above usual → 90–100, −1 SD → 60
 *   Recovery time left          20%   0 h → 100, 48 h → 0
 *   Resting HR vs 30-day usual  15%   −3 bpm or lower → 100, +7 → 0
 *   Resting respiration vs      10%   at or under usual → 100, +3 breaths/min
 *     30-night usual                  → 0. Overnight median (respiration.ts)
 *   Training load balance       15%   7 days vs 28, 0.8–1.3 → 100. Lifting
 *                                     load (strength.ts) when there is enough
 *                                     of it, else heart-rate load (load.ts)
 *
 * Missing inputs drop out and the rest are re-weighted; fewer than two inputs
 * means no score at all. A training guide, never a medical measure.
 */

export type ChargeKey = 'body_battery' | 'hrv' | 'recovery' | 'resting_hr' | 'respiration' | 'load'
export type ChargeBand = 'primed' | 'steady' | 'easy'

export interface ChargeInput {
  key: ChargeKey
  label: string
  /** What the input reads, for display: "74", "14 h", "+6 bpm", "+12%". */
  value: string
  /** 0–100. */
  score: number
  /** Weight after re-weighting, 0–1. */
  weight: number
  /** A clause naming this input, for the advice sentence. */
  phrase: string
}

export interface Charge {
  score: number
  band: ChargeBand
  bandLabel: 'Primed' | 'Steady' | 'Easy'
  inputs: ChargeInput[]
  /** One or two sentences: band, the input that mattered, what to do. */
  advice: string
  /** Up to ~20 characters, for the watch. */
  shortAdvice: string
}

// Weights are relative: inputs that are missing drop out and the rest are
// re-weighted, so respiration only dilutes the others when it is present.
const WEIGHTS: Record<ChargeKey, number> = { body_battery: 0.3, hrv: 0.2, recovery: 0.2, resting_hr: 0.15, respiration: 0.1, load: 0.15 }

/** Optional inputs beyond daily_body and sessions. */
export interface ChargeExtras {
  readiness?: ReadinessCheck[]
  strength?: StrengthSet[]
}

/** Mean morning Body Battery over the 7 days before `today`. */
function bbUsual(days: DailyBody[], today: string): number | null {
  const v = days
    .filter(d => d.local_date < today && daysBetween(d.local_date, today) <= 7)
    .map(d => d.bb_wake ?? d.bb_high)
    .filter((x): x is number => x != null)
  return v.length >= 3 ? v.reduce((a, b) => a + b, 0) / v.length : null
}

/** Readiness and lifting load for `today`, with the recovery signals that
 *  decide the lifting advice. One place, so Charge, the load card, the Coach
 *  and the watch can never disagree. */
export function bodyExtras(days: DailyBody[], today: string, extras: ChargeExtras = {}): {
  readiness: ReadinessSummary | null
  strength: StrengthLoad | null
} {
  const readiness = extras.readiness?.length ? summarizeReadiness(extras.readiness, today) : null
  const row = days.find(d => d.local_date === today)
  const baseline = restingBaseline(days, today)
  const signals: RecoverySignals = {
    restingDelta: row?.resting_hr != null && baseline != null ? row.resting_hr - baseline : null,
    hrvWeekZ: readiness?.weekZ ?? null,
    hrvZ: readiness?.z ?? null,
    bbToday: row?.bb_wake ?? row?.bb_high ?? null,
    bbUsual: bbUsual(days, today),
  }
  const strength = extras.strength?.length ? strengthLoad(extras.strength, today, signals) : null
  return { readiness, strength }
}
const MIN_BASELINE_DAYS = 5

export function chargeBand(score: number): ChargeBand {
  return score >= 75 ? 'primed' : score >= 50 ? 'steady' : 'easy'
}

/** Mean resting HR over the 30 days before `today`, or null with too few days. */
export function restingBaseline(days: DailyBody[], today: string): number | null {
  const vals = days
    .filter(d => d.resting_hr != null && d.local_date < today && daysBetween(d.local_date, today) <= 30)
    .map(d => d.resting_hr as number)
  if (vals.length < MIN_BASELINE_DAYS) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

export function computeCharge(days: DailyBody[], sessions: LoadSession[], today: string, extras: ChargeExtras = {}): Charge | null {
  const row = days.find(d => d.local_date === today)
  const raw: Omit<ChargeInput, 'weight'>[] = []
  const { readiness, strength } = bodyExtras(days, today, extras)

  const bb = row?.bb_wake ?? row?.bb_high ?? null
  if (bb != null) {
    raw.push({ key: 'body_battery', label: 'Body Battery', value: String(bb), score: clamp(bb, 0, 100), phrase: `Body Battery ${bb}` })
  }

  if (readiness?.today && readiness.z != null && readiness.baseline) {
    const { lowMs, highMs } = readiness.baseline
    raw.push({
      key: 'hrv',
      label: 'HRV check',
      value: `${Math.round(readiness.today.rmssd)} ms`,
      score: hrvScore(readiness.z),
      phrase:
        readiness.status === 'below'
          ? `this morning's HRV is under your usual ${lowMs}–${highMs} ms`
          : readiness.status === 'above'
            ? "this morning's HRV is above your usual"
            : "this morning's HRV is in your usual range",
    })
  }

  const rec = row?.recovery_hours ?? null
  if (rec != null) {
    raw.push({
      key: 'recovery',
      label: 'Recovery left',
      value: `${rec} h`,
      score: clamp(100 - (rec / 48) * 100, 0, 100),
      phrase: rec === 0 ? "you're fully recovered" : `${rec} h of recovery still left`,
    })
  }

  const baseline = restingBaseline(days, today)
  if (row?.resting_hr != null && baseline != null) {
    const delta = Math.round(row.resting_hr - baseline)
    raw.push({
      key: 'resting_hr',
      label: 'Resting HR',
      value: `${delta > 0 ? '+' : ''}${delta} bpm`,
      score: clamp(100 - (delta + 3) * 10, 0, 100),
      phrase:
        delta > 0
          ? `resting heart rate is ${delta} bpm over your usual`
          : delta < 0
            ? `resting heart rate is ${-delta} bpm under your usual`
            : 'resting heart rate is right at your usual',
    })
  }

  // Breathing faster than usual at rest is one of the earliest signs of
  // illness or strain, often a night before resting HR moves.
  const breaths = restingRespiration(row)
  const breathsUsual = respirationBaseline(days, today)
  if (breaths != null && breathsUsual != null) {
    const delta = Math.round((breaths - breathsUsual) * 10) / 10
    raw.push({
      key: 'respiration',
      label: 'Resting breathing',
      value: `${delta > 0 ? '+' : ''}${delta} /min`,
      score: clamp(100 - (delta / 3) * 100, 0, 100),
      phrase:
        delta >= 1
          ? `you breathed ${delta} breaths/min faster than usual overnight`
          : delta <= -1
            ? 'your overnight breathing was calmer than usual'
            : 'your overnight breathing was at your usual',
    })
  }

  const load = strength ? null : loadBalance(sessions, today)
  if (strength) {
    raw.push({
      key: 'load',
      label: 'Lifting load',
      value: `${strength.percent > 0 ? '+' : ''}${strength.percent}%`,
      score: strengthScore(strength),
      phrase:
        strength.advice === 'deload'
          ? `lifting is up ${strength.percent}% this week while recovery is slipping`
          : strength.band === 'high'
            ? "you've lifted a lot more than usual this week"
            : strength.band === 'low'
              ? "it's been a light lifting week"
              : 'your lifting load is building well',
    })
  } else if (load) {
    raw.push({
      key: 'load',
      label: 'Training load',
      value: `${load.percent > 0 ? '+' : ''}${load.percent}%`,
      score: loadScore(load.ratio),
      phrase:
        load.band === 'high'
          ? "you've ramped up training fast this week"
          : load.band === 'low'
            ? "it's been a light week"
            : 'your training load is building well',
    })
  }

  if (raw.length < 2) return null
  const total = raw.reduce((s, i) => s + WEIGHTS[i.key], 0)
  const inputs: ChargeInput[] = raw.map(i => ({ ...i, weight: WEIGHTS[i.key] / total }))
  const score = Math.round(inputs.reduce((s, i) => s + i.score * i.weight, 0))
  const band = chargeBand(score)
  return { score, band, bandLabel: BAND_LABEL[band], inputs, advice: adviceFor(band, inputs), shortAdvice: SHORT[band] }
}

const BAND_LABEL = { primed: 'Primed', steady: 'Steady', easy: 'Easy' } as const
const SHORT: Record<ChargeBand, string> = {
  primed: 'Push your top sets',
  steady: 'Train as planned',
  easy: 'Trim a set per lift',
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Names the inputs that decided the band: the best two when primed, the
 *  weakest one otherwise. */
export function adviceFor(band: ChargeBand, inputs: ChargeInput[]): string {
  const byScore = [...inputs].sort((a, b) => b.score - a.score)
  if (band === 'primed') {
    const top = byScore.slice(0, 2).map(i => i.phrase)
    return `Primed. ${capitalize(top.join(' and '))}. A good day to push your top sets.`
  }
  const weakest = byScore[byScore.length - 1]
  if (band === 'steady') {
    return `Steady. ${capitalize(weakest.phrase)}, so train as planned and leave PR attempts for another day.`
  }
  return `Easy. ${capitalize(weakest.phrase)}. Keep your weights and drop the last set of each lift.`
}
