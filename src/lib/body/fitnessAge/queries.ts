import type { SupabaseClient } from '@supabase/supabase-js'
import { overnightReadings, readRecoveryNights } from '../sleep'
import type { Calibration, RunActivity } from './calibration'
import { shiftDate, type FitnessDay } from './cardio'
import { computeFitnessAge, type FitnessAgeOutcome, type FitnessProfile } from './index'
import type { LiftSet } from './strengthAge'

/**
 * Loads 180 days of the caller's data and computes fitness age. Works with
 * either Supabase client; RLS keeps every read to the caller's own rows.
 *
 * Sources, best first when two cover the same night:
 *   Garmin Connect Personal (garmin_personal_days.measurements) → the watch
 *   app (daily_body) → imported sleep_sessions for HRV.
 */

export const HISTORY_DAYS = 180
const LBS_PER_KG = 2.2046226218

export type FitnessAgeRead =
  | FitnessAgeOutcome
  | { ok: false; reason: 'no_profile' | 'unavailable' }

const absentTable = (e: { code?: string } | null) => !!e && ['42P01', 'PGRST205'].includes(e.code ?? '')
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null)

export async function readFitnessProfile(db: SupabaseClient, userId: string) {
  const { data, error } = await db.from('fitness_profile').select('birth_date,sex,height_cm').eq('user_id', userId).maybeSingle()
  if (error) return { error: absentTable(error) ? 'unavailable' as const : 'failed' as const, profile: null }
  return { error: null, profile: data as FitnessProfile | null }
}

export async function readCalibrations(db: SupabaseClient, userId: string): Promise<Calibration[] | null> {
  const { data, error } = await db.from('fitness_calibrations')
    .select('measured_on,kind,value,source,activity_id,status')
    .eq('user_id', userId).order('measured_on')
  if (error) return null
  return (data ?? []).map(r => ({ ...r, value: Number(r.value) })) as Calibration[]
}

export async function getFitnessAge(db: SupabaseClient, userId: string, today: string): Promise<FitnessAgeRead> {
  const from = shiftDate(today, -HISTORY_DAYS + 1)
  const [profileRead, calibrations] = await Promise.all([readFitnessProfile(db, userId), readCalibrations(db, userId)])
  if (profileRead.error === 'unavailable') return { ok: false, reason: 'unavailable' }
  if (profileRead.error || calibrations == null) throw new Error('fitness_age_read_failed')
  if (!profileRead.profile) return { ok: false, reason: 'no_profile' }

  const [garmin, watch, acts, logs, weights, labels, nights] = await Promise.all([
    db.from('garmin_personal_days')
      .select('local_date,vo2_max:measurements->vo2_max,resting_hr:measurements->resting_hr,overnight_hrv:measurements->overnight_hrv,weight_kg:measurements->weight_kg,intensity_vigorous:measurements->intensity_vigorous')
      .eq('user_id', userId).gte('local_date', from).lte('local_date', today),
    db.from('daily_body').select('local_date,resting_hr,vo2max').eq('user_id', userId).gte('local_date', from).lte('local_date', today),
    db.from('garmin_personal_activities').select('provider_id,local_date,activity_type,details')
      .eq('user_id', userId).gte('local_date', from).lte('local_date', today),
    db.from('session_logs')
      .select('weight, reps, is_skipped, is_warmup, exercises(name), sessions!inner(user_id, local_date, completed_at)')
      .eq('sessions.user_id', userId).not('sessions.completed_at', 'is', null)
      .gte('sessions.local_date', from).lte('sessions.local_date', today).limit(10000),
    db.from('body_weights').select('recorded_at,weight').eq('user_id', userId).gte('recorded_at', from).lte('recorded_at', today).order('recorded_at'),
    db.from('body_signal_labels').select('local_date,tags').eq('user_id', userId).gte('local_date', from).lte('local_date', today),
    readRecoveryNights(db, userId, today).catch(() => new Map()),
  ])
  // Optional sources (tables a database may not have yet) read as empty; a
  // real failure on the core reads must not look like an empty account.
  for (const r of [garmin, watch, acts, labels]) if (r.error && !absentTable(r.error)) throw new Error('fitness_age_read_failed')
  if (logs.error || weights.error) throw new Error('fitness_age_read_failed')

  const days = new Map<string, FitnessDay>()
  const day = (date: string) => { let d = days.get(date); if (!d) { d = { date }; days.set(date, d) } return d }

  for (const r of (watch.data ?? []) as { local_date: string; resting_hr: number | null; vo2max: number | null }[]) {
    const d = day(r.local_date)
    d.rhr = num(r.resting_hr) ?? d.rhr
    d.vo2 = num(r.vo2max) ?? d.vo2
  }
  for (const [date, hrv] of overnightReadings(nights)) day(date).hrv = hrv
  const weightList: { date: string; lbs: number }[] = []
  for (const r of (garmin.data ?? []) as Record<string, unknown>[]) {
    const d = day(String(r.local_date))
    d.vo2 = num(r.vo2_max) ?? d.vo2 // Garmin's precise value beats the watch app's integer
    d.rhr = num(r.resting_hr) ?? d.rhr
    d.hrv = num(r.overnight_hrv) ?? d.hrv
    const kg = num(r.weight_kg)
    if (kg != null) { d.weightKg = kg; weightList.push({ date: d.date, lbs: kg * LBS_PER_KG }) }
    if ((num(r.intensity_vigorous) ?? 0) >= 10) d.active = true
  }
  for (const r of (weights.data ?? []) as { recorded_at: string; weight: number }[]) {
    const lbs = Number(r.weight)
    if (!(lbs > 0)) continue
    const d = day(r.recorded_at)
    d.weightKg ??= lbs / LBS_PER_KG
    if (!weightList.some(w => w.date === r.recorded_at)) weightList.push({ date: r.recorded_at, lbs })
  }
  weightList.sort((a, b) => a.date.localeCompare(b.date))
  for (const r of (labels.data ?? []) as { local_date: string; tags: string[] | null }[]) {
    if (r.tags?.some(t => t === 'sick' || t === 'alcohol')) day(r.local_date).tagged = true
  }

  const activities: RunActivity[] = []
  for (const r of (acts.data ?? []) as { provider_id: string; local_date: string; activity_type: string; details: Record<string, unknown> | null }[]) {
    const det = r.details ?? {}
    const splits = Array.isArray(det.splits)
      ? (det.splits as Record<string, unknown>[]).map(s => ({ duration: num(s.duration) ?? undefined, distance: num(s.distance) ?? undefined }))
      : null
    activities.push({
      provider_id: r.provider_id, local_date: r.local_date, activity_type: r.activity_type,
      distance_m: num(det.distance_m), duration_seconds: num(det.duration_seconds),
      average_hr: num(det.average_hr), max_hr: num(det.max_hr), splits,
    })
    if (/run|cycl|bik|rid|swim|row|ski/i.test(r.activity_type)) day(r.local_date).active = true
  }

  type LogRow = { weight: number | null; reps: number | null; is_skipped: boolean | null; is_warmup: boolean | null
    exercises: { name: string | null } | { name: string | null }[] | null
    sessions: { local_date: string | null } | { local_date: string | null }[] | null }
  const sets: LiftSet[] = []
  for (const r of (logs.data ?? []) as unknown as LogRow[]) {
    if (r.is_skipped || r.is_warmup) continue
    const s = Array.isArray(r.sessions) ? r.sessions[0] : r.sessions
    const e = Array.isArray(r.exercises) ? r.exercises[0] : r.exercises
    if (!s?.local_date) continue
    sets.push({ date: s.local_date, name: e?.name ?? null, weight: r.weight == null ? null : Number(r.weight), reps: r.reps })
  }

  return computeFitnessAge({
    profile: { ...profileRead.profile, height_cm: num(profileRead.profile.height_cm) },
    today,
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    activities,
    sets,
    weights: weightList,
    calibrations,
  })
}
