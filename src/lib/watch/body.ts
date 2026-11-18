import { bodyExtras, computeCharge, type ChargeBand, type DailyBody, type LoadSession, type ReadinessCheck, type StrengthSet } from '@/lib/body'
import type { WatchDailyInput, WatchSessionInput } from './schema'

/**
 * GRIND Body on the watch API: turning uploads into what migration 59's RPCs
 * store, and stored rows into the Charge the watch shows on Home.
 */

/** Session upload → watch_store_session_body's p_body, or null when the
 *  upload carries no heart-rate data at all (older watch builds). */
export function toBodyPayload(input: WatchSessionInput) {
  const sets = input.sets
    .filter(s => s.hr_peak != null || s.hr_end != null || s.hr_rest_drop_60 != null)
    .map(s => ({ id: s.id, hr_peak: s.hr_peak ?? null, hr_end: s.hr_end ?? null, hr_rest_drop_60: s.hr_rest_drop_60 ?? null }))
  const hr = input.hr
  const hasHr = hr && (hr.trace?.length || hr.zone_seconds || hr.training_effect != null || hr.zones)
  if (!hasHr && sets.length === 0) return null
  return {
    session_id: input.id,
    trace: hr?.trace?.length ? hr.trace : null,
    step: hr?.step ?? (hr?.trace?.length ? 5 : null),
    zones: hr?.zones ?? null,
    zone_seconds: hr?.zone_seconds ?? null,
    training_effect: hr?.training_effect != null ? Math.round(hr.training_effect * 10) / 10 : null,
    sets,
  }
}

const NOON_BUCKET = 48

/** Daily snapshot → watch_upsert_daily's p_day, with the aggregates derived. */
export function toDailyPayload(input: WatchDailyInput) {
  const bb = input.body_battery ?? null
  const stress = input.stress ?? null
  const bbVals = (bb ?? []).filter((v): v is number => v != null)
  if (input.body_battery_now != null) bbVals.push(input.body_battery_now)
  const morning = (bb ?? []).slice(0, NOON_BUCKET).filter((v): v is number => v != null)
  const stressVals = (stress ?? []).filter((v): v is number => v != null)
  let latest: number | null = input.body_battery_now ?? null
  if (latest == null && bb) {
    for (let i = bb.length - 1; i >= 0; i--) if (bb[i] != null) { latest = bb[i]; break }
  }
  return {
    local_date: input.date,
    bb,
    stress,
    bb_high: bbVals.length ? Math.max(...bbVals) : null,
    bb_low: bbVals.length ? Math.min(...bbVals) : null,
    bb_latest: latest,
    bb_wake: morning.length ? Math.max(...morning) : null,
    stress_avg: stressVals.length ? Math.round(stressVals.reduce((a, b) => a + b, 0) / stressVals.length) : null,
    resting_hr: input.resting_hr ?? null,
    recovery_hours: input.recovery_hours ?? null,
    steps: input.steps ?? null,
    active_minutes: input.active_minutes ?? null,
    floors: input.floors ?? null,
    spo2: input.spo2 ?? null,
    vo2max: input.vo2max ?? null,
    // Migration 69. The 59 RPC ignores these keys, so the order of applying
    // the SQL and deploying this doesn't matter.
    hr: input.heart_rate ?? null,
    steps_series: atBucket(input.bucket, input.steps),
    active_series: atBucket(input.bucket, input.active_minutes),
    floors_series: atBucket(input.bucket, input.floors),
    source: input.source ?? 'app',
  }
}

/** A running total placed on the day's 96-bucket curve at the bucket it was
 *  read in; every other bucket null, so the merge keeps earlier syncs. */
function atBucket(bucket: number | undefined, value: number | null | undefined): (number | null)[] | null {
  if (bucket == null || value == null) return null
  const out: (number | null)[] = new Array(96).fill(null)
  out[bucket] = value
  return out
}

export interface BodyContext {
  days: DailyBody[]
  sessions: LoadSession[]
  /** Migration 68; absent before it. */
  readiness?: ReadinessCheck[] | null
  strength?: StrengthSet[] | null
  prefs: { coach_uses_body: boolean; smart_rest: boolean } | null
}

export interface TodayBody {
  charge: { score: number; band: ChargeBand; label: string; advice: string } | null
  smart_rest: boolean
  /** For the readiness check's result screen: your usual range, and today's
   *  reading once one is in. Null until 5 mornings exist. */
  hrv: { low: number; high: number; days: number; today: number | null; status: 'below' | 'within' | 'above' | null } | null
  /** Lifting advice when it fired: Go lighter / Room to push. */
  lift: { advice: 'deload' | 'push'; headline: string; percent: number } | null
}

export function todayBody(ctx: BodyContext, localDate: string): TodayBody {
  const days = ctx.days ?? []
  const extras = { readiness: ctx.readiness ?? [], strength: ctx.strength ?? [] }
  const c = computeCharge(days, ctx.sessions ?? [], localDate, extras)
  const { readiness, strength } = bodyExtras(days, localDate, extras)
  const b = readiness?.baseline
  return {
    charge: c ? { score: c.score, band: c.band, label: c.bandLabel, advice: c.shortAdvice } : null,
    smart_rest: ctx.prefs?.smart_rest ?? false,
    hrv: b ? { low: b.lowMs, high: b.highMs, days: b.days, today: readiness?.today ? Math.round(readiness.today.rmssd) : null, status: readiness?.status ?? null } : null,
    lift: strength?.advice ? { advice: strength.advice, headline: strength.headline, percent: strength.percent } : null,
  }
}
