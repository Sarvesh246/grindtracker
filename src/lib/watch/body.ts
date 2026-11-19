import { bodyExtras, computeCharge, computeSignals, type BodySignals, type ChargeBand, type DailyBody, type LoadSession, type ReadinessCheck, type SignalLabel, type StrengthSet } from '@/lib/body'
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
  const trace = hr?.trace_b64 ? decodeTrace(hr.trace_b64) : hr?.trace
  const hasHr = hr && (trace?.length || hr.zone_seconds || hr.training_effect != null || hr.zones)
  if (!hasHr && sets.length === 0) return null
  return {
    session_id: input.id,
    trace: trace?.length ? trace : null,
    step: hr?.step ?? (trace?.length ? 5 : null),
    zones: hr?.zones ?? null,
    zone_seconds: hr?.zone_seconds ?? null,
    training_effect: hr?.training_effect != null ? Math.round(hr.training_effect * 10) / 10 : null,
    sets,
  }
}

/** One byte a reading, base64 → readings. A byte over 250 is no reading. */
export function decodeTrace(b64: string): number[] {
  return Array.from(Buffer.from(b64, 'base64'), v => (v > 250 ? 0 : v))
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
    // Migration 71; earlier RPCs ignore it.
    resp_series: atBucket(input.bucket, input.respiration),
    // Migration 72, tenths of a °C; earlier RPCs ignore it.
    temp_series: atBucket(input.bucket, input.temperature == null ? null : Math.round(input.temperature * 10)),
    source: input.source ?? 'app',
    // Migration 70: stored in body_sync_log; earlier RPCs ignore them.
    hr_raw: input.hr_raw ?? null,
    diag: input.diag ?? null,
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
  /** Migration 72; absent before it. */
  labels?: SignalLabel[] | null
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
  /** Body signals when they flag strain (mild or strong), for Home. */
  signals: { level: 'mild' | 'strong'; short: string } | null
}

/** Last night's body signals from the watch's context. */
export function contextSignals(ctx: BodyContext, localDate: string): BodySignals {
  return computeSignals(ctx.days ?? [], localDate, {
    readiness: ctx.readiness ?? [],
    sessions: ctx.sessions ?? [],
    labels: ctx.labels ?? [],
  })
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
    signals: watchSignals(contextSignals(ctx, localDate)),
  }
}

function watchSignals(s: BodySignals): TodayBody['signals'] {
  return (s.level === 'mild' || s.level === 'strong') && s.short ? { level: s.level, short: s.short } : null
}

/** The morning push, once the night is over (06:00–noon local) and only for a
 *  strong signal. */
export const PUSH_FROM_BUCKET = 24
export const PUSH_UNTIL_BUCKET = 47

export function signalPush(s: BodySignals): { title: string; body: string; url: string; tag: string } | null {
  if (s.level !== 'strong') return null
  return { title: s.headline, body: s.advice, url: '/progress/health', tag: 'grind-body-signal' }
}
