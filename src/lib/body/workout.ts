import type { HrSet } from './types'

/**
 * A watch workout's heart rate, read for people: which zone a number is in,
 * the beads of the heartbeat ribbon, and one sentence naming the hardest set
 * and the best recovery.
 */

/** Zone 1..5 for a heart rate given zone floors [z1, z2, z3, z4, z5, max]
 *  (Garmin's getHeartRateZones order). 0 = below zone 1. */
export function zoneOf(hr: number, zones: number[] | null | undefined): number {
  if (!zones || zones.length < 5) return 0
  let z = 0
  for (let i = 0; i < 5; i++) if (hr >= zones[i]) z = i + 1
  return z
}

export interface RibbonBead {
  set: HrSet
  /** Seconds from session start. */
  at: number
  peak: number
  zone: number
}

export interface WorkoutHeart {
  beads: RibbonBead[]
  /** The trace as [seconds, bpm] with gaps (0/null) dropped. */
  points: [number, number][]
  avg: number | null
  minutesHard: number | null
  sentence: string | null
  zoneSeconds: number[] | null
}

export interface WorkoutHeartInput {
  started_at: string
  hr_trace: (number | null)[] | null
  hr_step: number | null
  hr_zones: number[] | null
  zone_seconds: number[] | null
  avg_heart_rate: number | null
  sets: HrSet[]
}

export function workoutHeart(w: WorkoutHeartInput): WorkoutHeart | null {
  const step = w.hr_step ?? 5
  const points: [number, number][] = []
  ;(w.hr_trace ?? []).forEach((v, i) => {
    if (v != null && v > 0) points.push([i * step, v])
  })
  const start = Date.parse(w.started_at)
  const beads: RibbonBead[] = w.sets
    .filter(s => s.hr_peak != null)
    .map(s => ({
      set: s,
      at: s.completed_at ? Math.max(0, (Date.parse(s.completed_at) - start) / 1000) : 0,
      peak: s.hr_peak as number,
      zone: zoneOf(s.hr_peak as number, w.hr_zones),
    }))
    .sort((a, b) => a.at - b.at)
  if (points.length < 2 && beads.length === 0) return null

  const avg =
    w.avg_heart_rate ??
    (points.length ? Math.round(points.reduce((s, p) => s + p[1], 0) / points.length) : null)
  // Zones 3–5. A malformed row (not five numbers) shows no zone figures rather
  // than NaN minutes or a broken zone bar.
  const zones = w.zone_seconds?.length === 5 && w.zone_seconds.every(Number.isFinite) ? w.zone_seconds : null
  const minutesHard = zones ? Math.round((zones[2] + zones[3] + zones[4]) / 60) : null
  return { beads, points, avg, minutesHard, sentence: heartSentence(w.sets), zoneSeconds: zones }
}

/** "Hardest set: squat set 3 at 171 bpm. You recovered fastest between leg press sets." */
export function heartSentence(sets: HrSet[]): string | null {
  const withPeak = sets.filter(s => s.hr_peak != null)
  if (withPeak.length === 0) return null
  const hardest = withPeak.reduce((a, b) => ((b.hr_peak as number) > (a.hr_peak as number) ? b : a))
  let out = `Hardest set: ${(hardest.exercise_name ?? 'set').toLowerCase()} set ${hardest.set_number} at ${hardest.hr_peak} bpm.`

  const drops = new Map<string, { name: string; sum: number; n: number }>()
  for (const s of sets) {
    if (s.hr_rest_drop_60 == null) continue
    const d = drops.get(s.exercise_id) ?? { name: s.exercise_name ?? 'that exercise', sum: 0, n: 0 }
    d.sum += s.hr_rest_drop_60
    d.n += 1
    drops.set(s.exercise_id, d)
  }
  const ranked = [...drops.values()].filter(d => d.n >= 2).sort((a, b) => b.sum / b.n - a.sum / a.n)
  if (ranked.length >= 2) out += ` You recovered fastest between ${ranked[0].name.toLowerCase()} sets.`
  return out
}
