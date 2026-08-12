/**
 * Pure summary helpers for Coach USER_DATA — keep aggregation out of the
 * Supabase fetch layer so it stays unit-testable and token-cheap.
 */

import { calendarDaysBetween } from './trainingHistory'

export interface BodyWeightPoint {
  date: string
  weight_lbs: number
}

export interface BodyWeightSummary {
  latest_lbs: number | null
  latest_date: string | null
  delta_7d_lbs: number | null
  delta_30d_lbs: number | null
  min_90d_lbs: number | null
  max_90d_lbs: number | null
  n_logs_90d: number
}

/** Closest reading on or before `asOf - daysAgo` (null if none in window). */
function weightNear(
  sortedDesc: BodyWeightPoint[],
  asOf: string,
  daysAgo: number,
): number | null {
  const targetDays = daysAgo
  let best: BodyWeightPoint | null = null
  let bestDist = Infinity
  for (const p of sortedDesc) {
    if (p.date > asOf) continue
    const ago = calendarDaysBetween(p.date, asOf)
    if (ago < 0) continue
    // Prefer a reading within ±3 days of the target lookback; else nearest ≤ target+7.
    const dist = Math.abs(ago - targetDays)
    if (ago <= targetDays + 7 && dist < bestDist) {
      best = p
      bestDist = dist
    }
  }
  return best?.weight_lbs ?? null
}

/**
 * Summarize body-weight trend from recent readings (newest-first or any order).
 * `recentForPrompt` is a capped slice for the model; summary uses the full list.
 */
export function summarizeBodyWeight(
  points: BodyWeightPoint[],
  asOfLocalDate: string,
  recentLimit = 14,
): { summary: BodyWeightSummary; recent: BodyWeightPoint[] } {
  const valid = points
    .filter(p => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && Number.isFinite(p.weight_lbs))
    .filter(p => p.date <= asOfLocalDate)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

  const in90 = valid.filter(p => calendarDaysBetween(p.date, asOfLocalDate) <= 89)
  let min90: number | null = null
  let max90: number | null = null
  for (const p of in90) {
    if (min90 == null || p.weight_lbs < min90) min90 = p.weight_lbs
    if (max90 == null || p.weight_lbs > max90) max90 = p.weight_lbs
  }

  const latest = valid[0] ?? null
  const at7 = weightNear(valid, asOfLocalDate, 7)
  const at30 = weightNear(valid, asOfLocalDate, 30)

  return {
    summary: {
      latest_lbs: latest?.weight_lbs ?? null,
      latest_date: latest?.date ?? null,
      delta_7d_lbs:
        latest != null && at7 != null ? round1(latest.weight_lbs - at7) : null,
      delta_30d_lbs:
        latest != null && at30 != null ? round1(latest.weight_lbs - at30) : null,
      min_90d_lbs: min90,
      max_90d_lbs: max90,
      n_logs_90d: in90.length,
    },
    recent: valid.slice(0, recentLimit),
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export interface RawSetForSummary {
  exercise: string
  set_number: number
  weight_lbs: number | null
  reps: number | null
  is_pr: boolean
  is_warmup: boolean
  rpe: number | null
  note?: string | null
}

export interface ExerciseSessionRollup {
  exercise: string
  working_sets: number
  top_weight_lbs: number | null
  top_reps: number | null
  volume_lbs: number
  avg_rpe: number | null
  had_pr: boolean
  notes: string[]
}

export interface RpeSummary {
  /** Mean RPE across recent working sets that logged RPE. */
  recent_avg: number | null
  sets_with_rpe: number
  /** Exercises whose mean RPE in the window is ≥ 8.5 (high effort). */
  high_effort_exercises: string[]
}

export function summarizeRpe(sets: RawSetForSummary[]): RpeSummary {
  const byEx = new Map<string, number[]>()
  const all: number[] = []
  for (const s of sets) {
    if (s.is_warmup || s.rpe == null || !Number.isFinite(s.rpe)) continue
    all.push(s.rpe)
    const list = byEx.get(s.exercise) ?? []
    list.push(s.rpe)
    byEx.set(s.exercise, list)
  }
  const high_effort_exercises: string[] = []
  for (const [name, vals] of byEx) {
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length
    if (avg >= 8.5) high_effort_exercises.push(name)
  }
  high_effort_exercises.sort()
  return {
    recent_avg:
      all.length > 0
        ? Math.round((all.reduce((a, b) => a + b, 0) / all.length) * 10) / 10
        : null,
    sets_with_rpe: all.length,
    high_effort_exercises: high_effort_exercises.slice(0, 12),
  }
}

/** Roll working sets up per exercise for a single session (token-cheap). */
export function rollupSessionExercises(sets: RawSetForSummary[]): ExerciseSessionRollup[] {
  const map = new Map<string, ExerciseSessionRollup>()
  const order: string[] = []
  for (const s of sets) {
    if (s.is_warmup) continue
    let row = map.get(s.exercise)
    if (!row) {
      row = {
        exercise: s.exercise,
        working_sets: 0,
        top_weight_lbs: null,
        top_reps: null,
        volume_lbs: 0,
        avg_rpe: null,
        had_pr: false,
        notes: [],
      }
      map.set(s.exercise, row)
      order.push(s.exercise)
    }
    if (s.weight_lbs != null && s.reps != null) {
      row.working_sets += 1
      row.volume_lbs += s.weight_lbs * s.reps
      if (row.top_weight_lbs == null || s.weight_lbs > row.top_weight_lbs) {
        row.top_weight_lbs = s.weight_lbs
        row.top_reps = s.reps
      } else if (s.weight_lbs === row.top_weight_lbs && (row.top_reps == null || (s.reps ?? 0) > row.top_reps)) {
        row.top_reps = s.reps
      }
    }
    if (s.is_pr) row.had_pr = true
    if (s.rpe != null && Number.isFinite(s.rpe)) {
      // stash in notes? keep running sum via volume field abuse — use separate pass
    }
    const note = typeof s.note === 'string' ? s.note.trim() : ''
    if (note && row.notes.length < 3 && !row.notes.includes(note)) {
      row.notes.push(note.slice(0, 120))
    }
  }

  // avg RPE pass
  const rpeSums = new Map<string, { sum: number; n: number }>()
  for (const s of sets) {
    if (s.is_warmup || s.rpe == null) continue
    const cur = rpeSums.get(s.exercise) ?? { sum: 0, n: 0 }
    cur.sum += s.rpe
    cur.n += 1
    rpeSums.set(s.exercise, cur)
  }
  for (const [name, { sum, n }] of rpeSums) {
    const row = map.get(name)
    if (row) row.avg_rpe = Math.round((sum / n) * 10) / 10
  }

  return order.map(name => {
    const row = map.get(name)!
    return {
      ...row,
      volume_lbs: Math.round(row.volume_lbs),
    }
  })
}
