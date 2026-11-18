import { clamp, daysBetween, SWEET_SPOT } from './load'

/**
 * Strength training load: how much lifting you did, measured against your
 * own lifting, so a squat set and a curl set count fairly.
 *
 * Tonnage (weight × reps) alone would let one heavy leg day outweigh a week
 * of upper-body work, and heart-rate load (load.ts) badly underrates lifting.
 * Instead every working set is scored against the median set of the same
 * exercise over the trailing 90 days: a typical set is 1.0 "standard set", a
 * set with twice the usual weight × reps is 2.0 (capped at 3), a bodyweight
 * set compares reps. Summed per day, that reads like the hard-set counts
 * strength coaches use (Schoenfeld et al. 2017; Israetel's volume landmarks)
 * while still rising when the weights go up.
 *
 * The week is then compared with the month exactly like heart-rate load:
 * 7 days against the 28-day weekly average.
 *
 * Two pieces of advice come out of it, both only with enough history:
 *   - deload: load up more than 30% while recovery signals are falling;
 *   - room to push: three steady weeks, no estimated 1RM gains, and recovery
 *     fine.
 * Display and advice only; never XP, streaks, PRs or the leaderboard.
 */

export interface StrengthSet {
  local_date: string
  exercise_id: string
  exercise_name?: string | null
  /** Canonical lbs; null or 0 for bodyweight. */
  weight: number | null
  reps: number | null
}

const REFERENCE_DAYS = 90
const MIN_UNIT = 0.25
const MAX_UNIT = 3

function work(s: StrengthSet): number | null {
  if (s.reps == null || !(s.reps > 0)) return null
  return s.weight != null && s.weight > 0 ? s.weight * s.reps : s.reps
}

function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Standard sets per local date. Each exercise's reference is its median
 *  set over the 90 days up to `today`; weighted and bodyweight sets of the
 *  same exercise keep separate references. */
export function dailyStrength(sets: StrengthSet[], today: string): Map<string, number> {
  const refs = new Map<string, number[]>()
  const key = (s: StrengthSet) => `${s.exercise_id}|${s.weight != null && s.weight > 0 ? 'w' : 'bw'}`
  for (const s of sets) {
    const w = work(s)
    const age = daysBetween(s.local_date, today)
    if (w == null || age < 0 || age >= REFERENCE_DAYS) continue
    const k = key(s)
    if (!refs.has(k)) refs.set(k, [])
    refs.get(k)!.push(w)
  }
  const ref = new Map([...refs].map(([k, v]) => [k, median(v)]))
  const out = new Map<string, number>()
  for (const s of sets) {
    const w = work(s)
    const r = ref.get(key(s))
    if (w == null || !r) continue
    out.set(s.local_date, (out.get(s.local_date) ?? 0) + clamp(w / r, MIN_UNIT, MAX_UNIT))
  }
  return out
}

/** Epley estimated one-rep max, the same estimate the app uses for PRs. */
export function e1rm(weight: number, reps: number): number {
  return reps <= 1 ? weight : weight * (1 + reps / 30)
}

export type StrengthBand = 'low' | 'building' | 'high'
export type StrengthAdvice = 'deload' | 'push' | null

export interface StrengthLoad {
  /** Standard sets in the last 7 days, today included. */
  acute: number
  /** Weekly average over the last 28 days. */
  chronicWeekly: number
  ratio: number
  percent: number
  band: StrengthBand
  /** The last four weeks, oldest first, for the trend. */
  weeks: number[]
  advice: StrengthAdvice
  headline: string
  sentence: string
}

/** What the recovery side looks like, from Charge's other inputs. */
export interface RecoverySignals {
  /** Today's resting HR minus the 30-day usual, bpm. */
  restingDelta?: number | null
  /** 7-day HRV average vs baseline, in SDs (hrv.ts weekZ). */
  hrvWeekZ?: number | null
  /** Today's HRV vs baseline, in SDs. */
  hrvZ?: number | null
  /** Morning Body Battery today, and its 7-day average before today. */
  bbToday?: number | null
  bbUsual?: number | null
}

/** Which recovery signal is falling, as a clause, or null if none is. */
export function fallingRecovery(r: RecoverySignals): string | null {
  if (r.hrvWeekZ != null && r.hrvWeekZ <= -0.5) return 'your HRV has been running below your usual'
  if (r.hrvZ != null && r.hrvZ <= -1) return "this morning's HRV is below your usual range"
  if (r.restingDelta != null && r.restingDelta >= 3) return `your resting heart rate is ${Math.round(r.restingDelta)} bpm over your usual`
  if (r.bbToday != null && r.bbUsual != null && r.bbToday <= r.bbUsual - 15) return `your morning Body Battery is ${Math.round(r.bbUsual - r.bbToday)} under your usual`
  return null
}

function recoveryFine(r: RecoverySignals): boolean {
  const hrvOk = r.hrvWeekZ == null || r.hrvWeekZ > -0.25
  const rhrOk = r.restingDelta == null || r.restingDelta < 2
  const hasAny = r.hrvWeekZ != null || r.restingDelta != null || r.bbToday != null
  return hasAny && hrvOk && rhrOk && fallingRecovery(r) == null
}

/** Best e1RM per exercise in [from, to) days ago. */
function bests(sets: StrengthSet[], today: string, from: number, to: number): Map<string, number> {
  const out = new Map<string, number>()
  for (const s of sets) {
    const age = daysBetween(s.local_date, today)
    if (age < from || age >= to || s.weight == null || !(s.weight > 0) || s.reps == null || s.reps < 1 || s.reps > 15) continue
    const v = e1rm(s.weight, s.reps)
    if (v > (out.get(s.exercise_id) ?? 0)) out.set(s.exercise_id, v)
  }
  return out
}

/** True when no exercise trained in both windows gained more than 1% e1RM
 *  over the last 3 weeks, and at least two were compared. */
export function stalled(sets: StrengthSet[], today: string): boolean {
  const recent = bests(sets, today, 0, 21)
  const before = bests(sets, today, 21, 42)
  let compared = 0
  for (const [id, v] of recent) {
    const b = before.get(id)
    if (b == null) continue
    compared++
    if (v > b * 1.01) return false
  }
  return compared >= 2
}

export function strengthLoad(sets: StrengthSet[], today: string, recovery: RecoverySignals = {}): StrengthLoad | null {
  const daily = dailyStrength(sets, today)
  let oldest = 0
  const weeks = [0, 0, 0, 0]
  for (const [date, units] of daily) {
    const age = daysBetween(date, today)
    if (age < 0 || age >= 28) continue
    weeks[3 - Math.floor(age / 7)] += units
    oldest = Math.max(oldest, age)
  }
  const chronic = weeks.reduce((a, b) => a + b, 0)
  if (oldest < 14 || chronic <= 0) return null
  const acute = weeks[3]
  const chronicWeekly = chronic / 4
  const ratio = acute / chronicWeekly
  const percent = Math.round((ratio - 1) * 100)
  const band: StrengthBand = ratio < SWEET_SPOT[0] ? 'low' : ratio > SWEET_SPOT[1] ? 'high' : 'building'

  let advice: StrengthAdvice = null
  let headline = band === 'low' ? 'Lighter lifting week' : band === 'high' ? 'Heavier lifting week' : 'Lifting near your usual'
  const more = `${Math.abs(percent)}% ${percent >= 0 ? 'more' : 'less'} lifting than your monthly average`
  let sentence = `You did ${Math.round(acute)} standard sets this week, ${more}.`

  const falling = fallingRecovery(recovery)
  if (ratio > SWEET_SPOT[1] && falling) {
    advice = 'deload'
    headline = 'Go lighter'
    sentence = `Lifting is up ${percent}% this week while ${falling}. Keep your weights but drop a set per lift for the next few days.`
  } else if (oldest >= 21 && weeks.slice(1).every(w => w > 0)) {
    const last3 = weeks.slice(1)
    const m = last3.reduce((a, b) => a + b, 0) / 3
    const steady = last3.every(w => Math.abs(w - m) <= 0.1 * m)
    if (steady && stalled(sets, today) && recoveryFine(recovery)) {
      advice = 'push'
      headline = 'Room to push'
      sentence = `Three steady weeks at about ${Math.round(m)} standard sets, no strength gains in that time, and your recovery looks good. Add a set or a small jump in weight on your main lifts.`
    }
  }
  return { acute, chronicWeekly, ratio, percent, band, weeks: weeks.map(w => Math.round(w * 10) / 10), advice, headline, sentence }
}

/** Charge's 0–100 for the lifting side of load: the same curve as
 *  heart-rate load, plus a 30-point cut when the deload rule fired. */
export function strengthScore(load: StrengthLoad): number {
  const r = load.ratio
  const base = r >= SWEET_SPOT[0] && r <= SWEET_SPOT[1]
    ? 100
    : r < SWEET_SPOT[0] ? clamp(100 - (SWEET_SPOT[0] - r) * 125, 0, 100) : clamp(100 - (r - SWEET_SPOT[1]) * 200, 0, 100)
  return Math.round(clamp(base - (load.advice === 'deload' ? 30 : 0), 0, 100))
}
