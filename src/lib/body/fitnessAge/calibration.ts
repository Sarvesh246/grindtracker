/**
 * Calibration anchors (docs/FITNESS-AGE-RESEARCH.md §10): a maximal run, a lab
 * test or a grip reading, each with a known error, that pins down the personal
 * bias a wearable can't see by itself.
 */

export type CalibrationKind = 'run_5k' | 'cooper' | 'lab_cpet' | 'grip'

export interface Calibration {
  measured_on: string
  kind: CalibrationKind
  /** VO2max mL/kg/min, or grip kg. */
  value: number
  source: 'manual' | 'auto'
  activity_id?: string | null
  status: 'accepted' | 'rejected'
  /** Error SD of `value` (mL/kg/min); grip uses its own mapping error. */
  sd?: number
}

/** Daniels & Gilbert (1979) VDOT: oxygen cost of race pace over the fraction
 *  of VO2max that the race duration can be held for. */
export function vdot(distanceM: number, seconds: number): number | null {
  if (!(distanceM > 0) || !(seconds > 0)) return null
  const t = seconds / 60
  const v = distanceM / t
  const vo2 = -4.6 + 0.182258 * v + 0.000104 * v * v
  const fraction = 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t)
  return vo2 / fraction
}

/** Cooper (1968) 12-minute run. */
export const cooperVo2 = (distanceM: number) => (distanceM - 504.9) / 44.73

/** Anchor error SDs (§10.1). Uneven pacing widens a field test. */
export const ANCHOR_SD = { field: 2.5, fieldUneven: 3.5, lab: 2.0 } as const

/** Months an anchor stays fully trusted / fades to half weight (§10.3). */
export const ANCHOR_LIFE = {
  field: { full: 91, half: 182 },
  lab: { full: 182, half: 365 },
  grip: { full: 91, half: 182 },
} as const

export interface RunActivity {
  provider_id: string
  local_date: string
  activity_type: string
  distance_m?: number | null
  duration_seconds?: number | null
  average_hr?: number | null
  max_hr?: number | null
  splits?: { duration?: number; distance?: number }[] | null
}

const isRun = (type: string) => /run/i.test(type) && !/treadmill|indoor|trail/i.test(type)

/** The best HR evidence of your max: the highest activity max HR in the
 *  window, else Tanaka's 208 − 0.7 × age. */
export function observedHrMax(activities: RunActivity[], age: number): number {
  const seen = activities.map(a => a.max_hr ?? 0).filter(h => h > 120 && h < 230)
  return seen.length ? Math.max(...seen) : 208 - 0.7 * age
}

/** Split-pace coefficient of variation, or null without usable splits. */
function paceCv(splits: RunActivity['splits']): number | null {
  const paces = (splits ?? [])
    .filter(s => (s.distance ?? 0) >= 800 && (s.duration ?? 0) > 0)
    .map(s => s.duration! / s.distance!)
  if (paces.length < 3) return null
  const mean = paces.reduce((a, b) => a + b, 0) / paces.length
  const sd = Math.sqrt(paces.reduce((a, b) => a + (b - mean) ** 2, 0) / (paces.length - 1))
  return sd / mean
}

/**
 * Outdoor runs of 4.9–5.3 km held at ≥ 90% of HRmax on nights that weren't
 * flagged (sick / alcohol). Each becomes a run_5k anchor at SD 2.5, or 3.5 when
 * the split pace varies by more than 4%.
 */
export function detectFieldTests(activities: RunActivity[], age: number, flaggedDates: Set<string>): Calibration[] {
  const hrMax = observedHrMax(activities, age)
  const out: Calibration[] = []
  for (const a of activities) {
    const d = a.distance_m ?? 0
    const s = a.duration_seconds ?? 0
    if (!isRun(a.activity_type) || d < 4900 || d > 5300 || !(s > 0)) continue
    if (a.average_hr == null || a.average_hr < 0.9 * hrMax) continue
    if (flaggedDates.has(a.local_date)) continue
    const value = vdot(d, s)
    if (value == null || value < 10 || value > 100) continue
    const cv = paceCv(a.splits)
    out.push({
      measured_on: a.local_date, kind: 'run_5k', value, source: 'auto', activity_id: a.provider_id,
      status: 'accepted', sd: cv != null && cv > 0.04 ? ANCHOR_SD.fieldUneven : ANCHOR_SD.field,
    })
  }
  return out
}

/** Auto-detected tests the user hasn't rejected, plus manual accepted ones. */
export function effectiveCalibrations(stored: Calibration[], detected: Calibration[]): Calibration[] {
  const decided = new Map(stored.filter(c => c.activity_id).map(c => [c.activity_id!, c.status]))
  const auto = detected.filter(c => decided.get(c.activity_id!) !== 'rejected')
  const manual = stored.filter(c => c.status === 'accepted' && !c.activity_id)
  return [...manual, ...auto].map(c => ({
    ...c,
    sd: c.sd ?? (c.kind === 'lab_cpet' ? ANCHOR_SD.lab : c.kind === 'grip' ? undefined : ANCHOR_SD.field),
  }))
}
