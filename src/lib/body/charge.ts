import { clamp, daysBetween, loadBalance, loadScore } from './load'
import type { DailyBody, LoadSession } from './types'

/**
 * Charge: how ready you are to train today, 0–100, with its working shown.
 *
 *   Body Battery morning peak   40%   the value itself
 *   Recovery time left          25%   0 h → 100, 48 h → 0
 *   Resting HR vs 30-day usual  20%   −3 bpm or lower → 100, +7 → 0
 *   Training load balance       15%   7 days vs 28, 0.8–1.3 → 100
 *
 * Missing inputs drop out and the rest are re-weighted; fewer than two inputs
 * means no score at all. A training guide, never a medical measure.
 */

export type ChargeKey = 'body_battery' | 'recovery' | 'resting_hr' | 'load'
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

const WEIGHTS: Record<ChargeKey, number> = { body_battery: 0.4, recovery: 0.25, resting_hr: 0.2, load: 0.15 }
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

export function computeCharge(days: DailyBody[], sessions: LoadSession[], today: string): Charge | null {
  const row = days.find(d => d.local_date === today)
  const raw: Omit<ChargeInput, 'weight'>[] = []

  const bb = row?.bb_wake ?? row?.bb_high ?? null
  if (bb != null) {
    raw.push({ key: 'body_battery', label: 'Body Battery', value: String(bb), score: clamp(bb, 0, 100), phrase: `Body Battery ${bb}` })
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

  const load = loadBalance(sessions, today)
  if (load) {
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
