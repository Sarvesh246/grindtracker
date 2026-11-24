import { cooperVo2, vdot, type CalibrationKind } from './calibration'

/** Request validation for /api/fitness-age, kept pure so it's unit-tested. */

const DATE = /^\d{4}-\d{2}-\d{2}$/
const isDate = (v: unknown): v is string =>
  typeof v === 'string' && DATE.test(v) && !Number.isNaN(new Date(`${v}T12:00:00`).getTime())

type Ok<T> = { ok: true; value: T }
type Bad = { ok: false; reason: string }

export function validateToday(v: unknown, fallback: string): string {
  return isDate(v) ? v : fallback
}

export function validateProfile(body: Record<string, unknown>, today: string): Ok<{ birth_date: string; sex: 'male' | 'female'; height_cm: number | null }> | Bad {
  const { birth_date, sex, height_cm } = body
  if (!isDate(birth_date)) return { ok: false, reason: 'birth_date must be YYYY-MM-DD' }
  const years = (new Date(`${today}T12:00:00`).getTime() - new Date(`${birth_date}T12:00:00`).getTime()) / (365.2425 * 86_400_000)
  if (years < 13 || years > 110) return { ok: false, reason: 'birth_date out of range' }
  if (sex !== 'male' && sex !== 'female') return { ok: false, reason: 'sex must be male or female' }
  let height: number | null = null
  if (height_cm != null) {
    const h = Number(height_cm)
    if (!Number.isFinite(h) || h < 100 || h > 250) return { ok: false, reason: 'height_cm must be 100–250' }
    height = Math.round(h * 10) / 10
  }
  return { ok: true, value: { birth_date, sex, height_cm: height } }
}

export type CalibrationRequest =
  | { type: 'manual'; row: { measured_on: string; kind: CalibrationKind; value: number; raw: Record<string, number> } }
  | { type: 'decision'; activity_id: string; measured_on: string; value: number; status: 'accepted' | 'rejected' }

/**
 * Manual: {kind:'run_5k', measured_on, seconds} (distance defaults to 5000 m),
 * {kind:'cooper', measured_on, distance_m}, {kind:'lab_cpet', measured_on, vo2max},
 * {kind:'grip', measured_on, kg}.
 * Decision on an auto-detected run: {activity_id, measured_on, value, status}.
 */
export function validateCalibration(body: Record<string, unknown>, today: string): Ok<CalibrationRequest> | Bad {
  if (typeof body.activity_id === 'string' && body.activity_id) {
    if (body.status !== 'accepted' && body.status !== 'rejected') return { ok: false, reason: 'status must be accepted or rejected' }
    if (!isDate(body.measured_on)) return { ok: false, reason: 'measured_on must be YYYY-MM-DD' }
    const value = Number(body.value)
    if (!(value >= 10 && value <= 100)) return { ok: false, reason: 'value out of range' }
    return { ok: true, value: { type: 'decision', activity_id: body.activity_id.slice(0, 64), measured_on: body.measured_on, value, status: body.status } }
  }
  const kind = body.kind
  if (!isDate(body.measured_on) || body.measured_on > today) return { ok: false, reason: 'measured_on must be a past YYYY-MM-DD' }
  const measured_on = body.measured_on
  const n = (k: string) => Number(body[k])
  let value: number | null = null
  let raw: Record<string, number> = {}
  if (kind === 'run_5k') {
    const seconds = n('seconds')
    const distance = body.distance_m == null ? 5000 : n('distance_m')
    if (!(seconds >= 600 && seconds <= 7200) || !(distance >= 3000 && distance <= 10000)) return { ok: false, reason: 'seconds/distance_m out of range' }
    value = vdot(distance, seconds); raw = { seconds, distance_m: distance }
  } else if (kind === 'cooper') {
    const distance = n('distance_m')
    if (!(distance >= 900 && distance <= 5500)) return { ok: false, reason: 'distance_m out of range' }
    value = cooperVo2(distance); raw = { distance_m: distance }
  } else if (kind === 'lab_cpet') {
    value = n('vo2max'); raw = { vo2max: value }
  } else if (kind === 'grip') {
    const kg = n('kg')
    if (!(kg >= 5 && kg <= 100)) return { ok: false, reason: 'kg must be 5–100' }
    return { ok: true, value: { type: 'manual', row: { measured_on, kind, value: kg, raw: { kg } } } }
  } else return { ok: false, reason: 'kind must be run_5k, cooper, lab_cpet or grip' }
  if (value == null || !(value >= 10 && value <= 100)) return { ok: false, reason: 'resulting VO2max out of range' }
  return { ok: true, value: { type: 'manual', row: { measured_on, kind, value: Math.round(value * 10) / 10, raw } } }
}
