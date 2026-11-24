import { detectFieldTests, effectiveCalibrations, type Calibration, type RunActivity } from './calibration'
import { cardioAge, flagNights, round1, type CardioResult, type FitnessDay, type Sport } from './cardio'
import { MAX_AGE, MIN_AGE, WEIGHTS, type Sex } from './norms'
import { recoveryAge, type RecoveryResult } from './recoveryAge'
import { strengthAge, type LiftSet, type StrengthResult } from './strengthAge'

/**
 * Fitness age: Cardio, Strength, Recovery and the overall GRIND age
 * (docs/FITNESS-AGE-RESEARCH.md §9–§10). Pure: queries.ts loads the inputs.
 * Display only; never XP, streaks, PRs or the leaderboard.
 */

export interface FitnessProfile {
  birth_date: string
  sex: Sex
  height_cm?: number | null
}

export interface FitnessAgeInput {
  profile: FitnessProfile
  today: string
  days: FitnessDay[]
  activities: RunActivity[]
  sets: LiftSet[]
  /** Body weight in canonical lbs, by date. */
  weights: { date: string; lbs: number }[]
  calibrations: Calibration[]
}

export interface FitnessAgeResult {
  age: number
  cardio: CardioResult | null
  strength: StrengthResult | null
  recovery: RecoveryResult | null
  grind: { age: number; range: [number, number]; weights: Partial<Record<'cardio' | 'strength' | 'recovery', number>> } | null
  /** Auto-detected 5 km efforts used as anchors, so they can be shown / rejected. */
  autoCalibrations: Calibration[]
  /** What's missing or stale, for a "Calibrate" prompt (§10.4). */
  calibrate: { cardio: 'missing' | 'stale' | null; strength: 'missing' | 'stale' | null }
}

/** Whole years on `today` from a YYYY-MM-DD birth date (fractional). */
export function ageOn(birthDate: string, today: string): number {
  const b = new Date(`${birthDate}T12:00:00`)
  const t = new Date(`${today}T12:00:00`)
  return (t.getTime() - b.getTime()) / (365.2425 * 86_400_000)
}

export type FitnessAgeOutcome =
  | { ok: true; result: FitnessAgeResult }
  | { ok: false; reason: 'under_18' | 'over_90' }

export function computeFitnessAge(input: FitnessAgeInput): FitnessAgeOutcome {
  const { profile, today } = input
  const age = ageOn(profile.birth_date, today)
  if (age < MIN_AGE) return { ok: false, reason: 'under_18' }
  if (age > MAX_AGE + 1) return { ok: false, reason: 'over_90' }
  const sex = profile.sex
  const flags = flagNights(input.days)

  const runs = input.activities.filter(a => /run/i.test(a.activity_type)).length
  const rides = input.activities.filter(a => /cycl|bik|rid/i.test(a.activity_type)).length
  const sport: Sport = rides > runs ? 'cycling' : 'running'

  const detected = detectFieldTests(input.activities, age, flags.flagged)
  const anchors = effectiveCalibrations(input.calibrations, detected)

  const cardio = cardioAge({ sex, age, heightCm: profile.height_cm, sport, today, days: input.days, anchors, flags })
  const strength = strengthAge({ sex, age, today, sets: input.sets, weights: input.weights, anchors })
  const recovery = recoveryAge({ sex, age, today, days: input.days, flags })

  let grind: FitnessAgeResult['grind'] = null
  if (cardio) {
    type Part = ['cardio' | 'strength' | 'recovery', number, { age: number; range: [number, number] } | null]
    const all: Part[] = [['cardio', WEIGHTS.cardio, cardio], ['strength', WEIGHTS.strength, strength], ['recovery', WEIGHTS.recovery, recovery]]
    const parts = all.filter((p): p is [Part[0], number, NonNullable<Part[2]>] => p[2] != null)
    const total = parts.reduce((s, [, w]) => s + w, 0)
    const value = parts.reduce((s, [, w, r]) => s + (w / total) * r.age, 0)
    const half = Math.sqrt(parts.reduce((s, [, w, r]) => s + ((w / total) * (r.range[1] - r.range[0]) / 2) ** 2, 0))
    grind = {
      age: round1(value),
      range: [round1(Math.max(MIN_AGE, value - half)), round1(Math.min(MAX_AGE, value + half))],
      weights: Object.fromEntries(parts.map(([k, w]) => [k, Math.round((w / total) * 100) / 100])),
    }
  }

  const status = (confidence: string | undefined, hasAnchor: boolean) =>
    confidence && confidence !== 'uncalibrated' ? null : hasAnchor ? 'stale' as const : 'missing' as const
  return {
    ok: true,
    result: {
      age: round1(age),
      cardio,
      strength,
      recovery,
      grind,
      autoCalibrations: detected,
      calibrate: {
        cardio: status(cardio?.confidence, anchors.some(a => a.kind !== 'grip')),
        strength: status(strength?.confidence, anchors.some(a => a.kind === 'grip')),
      },
    },
  }
}

export type { Calibration, RunActivity } from './calibration'
export type { CardioResult, FitnessDay } from './cardio'
export type { LiftSet, StrengthResult } from './strengthAge'
export type { RecoveryResult } from './recoveryAge'
export type { Sex } from './norms'
export { vdot, cooperVo2 } from './calibration'
