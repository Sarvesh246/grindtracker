import type { Confidence, EnergyCheckin, Night } from './types'

/**
 * The science half of GRIND Energy. Pure functions over clock hours; see
 * docs/ENERGY.md for the sources behind every constant.
 */

export const MODEL_VERSION = 4

/** How far back to look for nights; shared by the page read and the cron read. */
export const LOOKBACK_DAYS = 28

/**
 * Sleep lengths GRIND trusts (exclusive bounds). Outside this is a tracking error
 * or a doze, not a night, and every consumer (need, debt, nights) applies it alike.
 */
export const MIN_NIGHT_H = 2
export const MAX_NIGHT_H = 14
export const isPlausibleSleep = (h: number) => h > MIN_NIGHT_H && h < MAX_NIGHT_H

// ── Sleep debt: a running 14-night balance ───────────────────────────────────

export const DEBT_NIGHTS = 14
/** Beyond this, the balance is tracking noise, not recoverable debt. */
export const MAX_DEBT_H = 20

/**
 * Sleep debt as a running balance over the last 14 nights, oldest first: each
 * night adds (need − slept − naps), extra sleep pays it back, and it never goes
 * below zero (you can't bank sleep ahead). This is the cumulative deficit of
 * Van Dongen 2003, repaid only by actually sleeping more (Kitamura 2016). It
 * replaces RISE-style recency weighting, which, scaled to 14 nights, counted
 * last night 2.1× its real shortfall.
 */
export function sleepDebt(nights: Night[], needH: number): number {
  // Same plausibility rule as sleepNeed: a 14h "night" or a 1h doze isn't debt evidence.
  const window = nights.filter((n) => isPlausibleSleep(n.sleepH)).slice(0, DEBT_NIGHTS)
  let balance = 0
  for (let i = window.length - 1; i >= 0; i--) {
    const n = window[i]
    balance = Math.max(0, Math.min(MAX_DEBT_H, balance + needH - n.sleepH - (n.napH ?? 0)))
  }
  return balance
}

// ── Circadian phase ──────────────────────────────────────────────────────────

/** Phase moves at most ~1h a day, so recent nights matter most: 3-night half-life. */
const PHASE_HALF_LIFE = 3
/** DLMO sits ~2h before habitual sleep onset (Burgess & Fogg 2008). */
const DLMO_BEFORE_ONSET = 2
/** …and ~6h before mid-sleep (Kantermann 2015; Burgess 2003). */
const DLMO_BEFORE_MID = 6
/** Felt-energy calibration can move the clock at most this far. */
export const MAX_CALIBRATION_H = 1.5

export interface Phase {
  /** Dim-light melatonin onset, clock hours (≈21 for a 23:00–07:00 sleeper). */
  dlmo: number
  habitualOnset: number
  habitualWake: number
  /** Spread of mid-sleep across nights, hours. */
  midSpread: number
  calibrationH: number
}

function weightedMean(values: number[], weights: number[]): number {
  const total = weights.reduce((s, w) => s + w, 0)
  return values.reduce((s, v, i) => s + v * weights[i], 0) / total
}

export function circadianPhase(nights: Night[], checkins: EnergyCheckin[] = []): Phase | null {
  const recent = nights.slice(0, DEBT_NIGHTS)
  if (!recent.length) return null
  const weights = recent.map((_, i) => Math.pow(0.5, i / PHASE_HALF_LIFE))
  const meanSleep = recent.reduce((s, n) => s + n.sleepH, 0) / recent.length

  // Roenneberg's correction: a long lie-in pushes mid-sleep late without the
  // clock having moved, so pull each night's mid back by half its oversleep.
  const mids = recent.map((n) => (n.onset + n.wake) / 2 - Math.max(0, n.sleepH - meanSleep) / 2)
  const mid = weightedMean(mids, weights)
  const onset = weightedMean(
    recent.map((n) => n.onset),
    weights,
  )
  const wake = weightedMean(
    recent.map((n) => n.wake),
    weights,
  )
  const spread = Math.sqrt(
    mids.reduce((s, m) => s + (m - mid) ** 2, 0) / Math.max(1, mids.length - 1),
  )

  const base = ((mid - DLMO_BEFORE_MID) + (onset - DLMO_BEFORE_ONSET)) / 2 + 24
  const calibrationH = calibrationOffset(base, checkins)
  return {
    dlmo: base + calibrationH,
    habitualOnset: onset,
    habitualWake: wake,
    midSpread: spread,
    calibrationH,
  }
}

/** Where the dip centre sits relative to DLMO (≈15:00 for a 21:00 DLMO). */
const DIP_BEFORE_DLMO = 6

/**
 * GRIND's edge over RISE: learn from how the user actually felt. Every "tired"
 * tap within 3h of the predicted dip votes for where the dip really is; the
 * median vote is shrunk toward zero (3 pseudo-votes) and capped at ±1.5h.
 */
export function calibrationOffset(dlmo: number, checkins: EnergyCheckin[]): number {
  const dip = dlmo - DIP_BEFORE_DLMO
  const votes = checkins
    .filter((c) => c.feeling === -1 && Math.abs(c.hour - dip) <= 3)
    .map((c) => c.hour - dip)
    .sort((a, b) => a - b)
  if (!votes.length) return 0
  const mid = Math.floor(votes.length / 2)
  const median = votes.length % 2 ? votes[mid] : (votes[mid - 1] + votes[mid]) / 2
  const shrunk = (median * votes.length) / (votes.length + 3)
  return Math.max(-MAX_CALIBRATION_H, Math.min(MAX_CALIBRATION_H, shrunk))
}

export function confidenceOf(nightCount: number, midSpread: number): Confidence {
  const coverage = Math.min(1, nightCount / 7)
  const regularity = midSpread < 0.75 ? 1 : midSpread < 1.5 ? 0.75 : 0.5
  const score = coverage * regularity
  return score >= 0.75 ? 'high' : score >= 0.4 ? 'medium' : 'low'
}

// ── Alertness: Åkerstedt–Folkard Three-Process Model ─────────────────────────

/** Process S starts near 14 after a full night; each hour of debt lowers it. */
const S_RESTED = 14
/**
 * Chronic debt lowers felt energy with a plateau, not a straight line: in Van
 * Dongen 2003, sleepiness under 14 days of restriction rose ~1 point on the
 * 7-point Stanford scale within days and then levelled off (performance kept
 * falling; felt energy is what GRIND draws). ~1.3 KSS points = 2.2 alertness
 * units (KSS = 10.6 − 0.6·alertness), approached with a ~6h debt constant.
 */
const CHRONIC_MAX_S = 2.2
const CHRONIC_TAU_H = 6
/** Most catch-up a recovery model trusts; past this, numbers are tracking noise. */
const DEBT_CAP_H = 20
/** Circadian C peaks at 16.8h for a 21:00 DLMO, i.e. 4.2h before DLMO. */
const C_PEAK_BEFORE_DLMO = 4.2
/** 12h harmonic that carves the post-lunch dip; deepens with debt. */
const U_AMPLITUDE = 1
/**
 * Sleep loss deepens the post-lunch dip specifically: afternoon sleep latency
 * shortens most after restriction (Carskadon & Dement 1987; Monk 2005 review).
 * Cohen 2010's chronic-loss amplification is in the biological NIGHT, which a
 * waking-day curve doesn't reach, so C is left alone and only U grows, saturating
 * like felt sleepiness. Up to +40%: the size is a calibration choice, the
 * direction is the evidence.
 */
const DIP_DEBT_GAIN = 0.4

export interface DayModel {
  wake: number
  dlmo: number
  /**
   * Chronic debt carried from earlier nights, plus the recovery adjustment, never
   * below 0. Last night is NOT in here; it acts through `lastSleepH`.
   */
  debtH: number
  /** Hours slept last night; sets this morning's sleep pressure. Absent = a full night. */
  lastSleepH?: number
  /** Today's naps, clock hours. Sleep pressure recovers during each one. */
  naps?: { start: number; end: number }[]
  /** Sleep-inertia decay rate; slower after waking from deep sleep. */
  inertiaRate?: number
}

const FULL_NIGHT_H = 8

/**
 * Process S at wake after `sleptH` of sleep, from the three-process equations
 * themselves: S falls through the preceding (24 − slept) hours awake, then
 * recovers S' = 14.3 − (14.3 − S)·e^(−0.381·slept). A full 8h night lands at
 * ≈14.05; 5h at ≈13.4; 3h at ≈12.4. Expressed relative to S_RESTED.
 */
export function acuteS0(sleptH: number): number {
  const at = (h: number) => {
    const awake = Math.max(0, 24 - h)
    const bed = 2.4 + (S_RESTED - 2.4) * Math.exp(-0.0353 * awake)
    return 14.3 - (14.3 - bed) * Math.exp(-0.381 * h)
  }
  return S_RESTED + at(Math.max(0, Math.min(14, sleptH))) - at(FULL_NIGHT_H)
}

/** Felt-energy cost of chronic debt: saturating, per Van Dongen 2003. */
export function chronicPenalty(debtH: number): number {
  const d = Math.max(0, Math.min(DEBT_CAP_H, debtH))
  return CHRONIC_MAX_S * (1 - Math.exp(-d / CHRONIC_TAU_H))
}

/** S at wake for this day: last night's sleep, minus the chronic plateau. */
export function startS(day: Pick<DayModel, 'debtH' | 'lastSleepH'>): number {
  return Math.min(S_RESTED, acuteS0(day.lastSleepH ?? FULL_NIGHT_H)) - chronicPenalty(day.debtH)
}

/** Default inertia decay (Åkerstedt–Folkard); waking from deep sleep uses the slower one. */
const INERTIA_RATE = 1.51
export const DEEP_WAKE_INERTIA_RATE = 1.0

/** True while `h` falls inside one of today's naps. */
export function inNap(day: DayModel, h: number): boolean {
  return !!day.naps?.some((n) => h >= n.start && h < n.end)
}

/**
 * Three-process alertness at clock hour `h` (Ingre et al. 2014 parameters).
 * Naps are handled piecewise: S decays from wake, recovers during the nap
 * (S' = 14.3 − (14.3 − S)·e^(−0.381·dur)), then decays again from the nap's
 * end, with a lighter inertia dip afterwards scaled by the nap's length.
 */
export function alertness(day: DayModel, h: number): number {
  let s0 = startS(day)
  let from = day.wake
  let napInertia = 0
  for (const nap of [...(day.naps ?? [])].sort((a, b) => a.start - b.start)) {
    if (nap.start < day.wake || nap.start >= h) continue
    const atStart = 2.4 + (s0 - 2.4) * Math.exp(-0.0353 * (nap.start - from))
    const slept = Math.min(h, nap.end) - nap.start
    s0 = 14.3 - (14.3 - atStart) * Math.exp(-0.381 * slept)
    from = Math.min(h, nap.end)
    // Short naps barely leave inertia; an hour+ nap gives about half a morning's worth.
    napInertia = -5.72 * 0.5 * Math.min(1, slept) * Math.exp(-INERTIA_RATE * Math.max(0, h - nap.end))
  }
  const t = Math.max(0, h - day.wake)
  const S = 2.4 + (s0 - 2.4) * Math.exp(-0.0353 * Math.max(0, h - from))
  const gain = 1 + DIP_DEBT_GAIN * (chronicPenalty(day.debtH) / CHRONIC_MAX_S)
  const C = 2.5 * Math.cos((2 * Math.PI * (h - (day.dlmo - C_PEAK_BEFORE_DLMO))) / 24)
  const W = -5.72 * Math.exp(-(day.inertiaRate ?? INERTIA_RATE) * t) + napInertia
  const U = -U_AMPLITUDE * gain * Math.cos((2 * Math.PI * (h - (day.dlmo - DIP_BEFORE_DLMO))) / 12)
  return S + C + W + U
}

/**
 * Alertness mapped onto the 0–100 scale the UI draws. Absolute three-process
 * units are meaningless to a reader and collapse under heavy debt, so the day's
 * own range becomes the shape and sleep pressure lowers the ceiling (see below).
 * `s0` is the day's starting sleep pressure from `startS`.
 */
export function toPercents(raw: number[], s0: number, range?: [number, number]): number[] {
  if (!raw.length) return []
  const [lo, hi] = range ?? [Math.min(...raw), Math.max(...raw)]
  // The ceiling drops 10 points per unit of morning sleep pressure lost (≈1.7 KSS
  // points per 10): a full night tops out at 95, the plateau of chronic debt
  // plus a 5h night near 66.
  const top = Math.max(55, Math.min(95, 95 - 10 * (S_RESTED - s0)))
  const span = Math.max(1e-6, hi - lo)
  // Grogginess and the late evening fall below the active range; let them sink toward 0.
  return raw.map((a) => Math.round(Math.max(2, Math.min(top, 15 + ((a - lo) / span) * (top - 15)))))
}

/** Low and high of alertness across the active day (grogginess over → DLMO). */
export function activeRange(day: DayModel): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (let h = day.wake + groggyHours(day); h <= day.dlmo; h += STEP) {
    if (inNap(day, h)) continue
    const a = alertness(day, h)
    lo = Math.min(lo, a)
    hi = Math.max(hi, a)
  }
  return lo < hi ? [lo, hi] : [lo - 1, lo + 1]
}

// ── Turning the curve into named phases ──────────────────────────────────────

/** Sleep inertia is "over" once W has recovered 90% (≈1.5h; RISE says ~90 min; ≈2.3h from deep sleep). */
function groggyHours(day: Pick<DayModel, 'inertiaRate'>): number {
  return Math.log(10) / (day.inertiaRate ?? INERTIA_RATE)
}
const STEP = 5 / 60

function argExtreme(day: DayModel, from: number, to: number, sign: 1 | -1): number {
  let best = from
  let bestV = -Infinity
  for (let h = from; h <= to + 1e-9; h += STEP) {
    if (inNap(day, h)) continue
    const v = sign * alertness(day, h)
    if (v > bestV) {
      bestV = v
      best = h
    }
  }
  return best
}

/** Expand outward from `centre` while the curve stays on the right side of `level`. */
function windowAround(
  day: DayModel,
  centre: number,
  level: number,
  above: boolean,
  lo: number,
  hi: number,
): [number, number] {
  const inside = (h: number) =>
    !inNap(day, h) && (above ? alertness(day, h) >= level : alertness(day, h) <= level)
  let a = centre
  while (a - STEP >= lo && inside(a - STEP)) a -= STEP
  let b = centre
  while (b + STEP <= hi && inside(b + STEP)) b += STEP
  return [a, b]
}

/** Keep a window to at most `maxH`, trimmed evenly around its extreme. */
function cap([a, b]: [number, number], centre: number, maxH: number): [number, number] {
  if (b - a <= maxH) return [a, b]
  const half = maxH / 2
  let lo = Math.max(a, centre - half)
  let hi = Math.min(b, centre + half)
  if (hi - lo < maxH) {
    if (lo === a) hi = Math.min(b, a + maxH)
    else lo = Math.max(a, b - maxH)
  }
  return [lo, hi]
}

export interface PhaseTimes {
  grogginessEnd: number
  morningPeak: [number, number]
  dip: [number, number]
  eveningPeak: [number, number]
  windDown: [number, number]
}

/**
 * Bounded searches rather than generic turning points: the morning peak lives
 * between grogginess and the dip region, the dip before the evening, and the
 * evening peak in the wake-maintenance zone before DLMO. That keeps a flat or
 * unusual curve from producing nonsense (two dips, a peak at 05:00).
 */
export function phaseTimes(day: DayModel): PhaseTimes {
  const grogginessEnd = day.wake + groggyHours(day)
  const dipGuess = day.dlmo - DIP_BEFORE_DLMO
  const mPeak = argExtreme(day, grogginessEnd, Math.max(grogginessEnd, dipGuess - 1.5), 1)
  const dip = argExtreme(day, Math.max(mPeak + 1, dipGuess - 2.5), dipGuess + 2.5, -1)
  const ePeak = argExtreme(day, dip + 1, day.dlmo, 1)

  const vM = alertness(day, mPeak)
  const vD = alertness(day, dip)
  const vE = alertness(day, ePeak)
  const swing = Math.max(0.2, Math.min(vM, vE) - vD)

  const morningPeak = cap(windowAround(day, mPeak, vM - 0.3 * swing, true, grogginessEnd, dip), mPeak, 3)
  const dipWin = cap(windowAround(day, dip, vD + 0.3 * swing, false, mPeak, ePeak), dip, 2.5)
  const eveningPeak = cap(windowAround(day, ePeak, vE - 0.3 * swing, true, dip, day.dlmo), ePeak, 3)

  return {
    grogginessEnd,
    morningPeak: [Math.max(grogginessEnd, morningPeak[0]), morningPeak[1]],
    dip: dipWin,
    eveningPeak,
    windDown: [day.dlmo, day.dlmo + 1],
  }
}

/** Minutes it typically takes to fall asleep. */
export const SLEEP_LATENCY_H = 0.25
