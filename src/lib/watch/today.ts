import type { UserRotation } from '@/lib/types'
import { LBS_PER_KG } from '@/lib/utils/units'
import { formatDayType } from '@/lib/utils/formatting'
import { rotationStateFrom } from '@/lib/utils/rotationStore'

/**
 * GET /api/watch/v1/today — turn the rows `watch_today_context` returns into
 * the compact plan the watch shows. Pure, so the size budget and the "up next"
 * choice are unit-tested without a database.
 */

/** Watches have little memory: cap what one plan can cost (docs/watch-api.md). */
export const MAX_TODAY_EXERCISES = 20
export const MAX_NAME_CHARS = 32

export interface TodayContextExercise {
  id: string
  name: string
  day_type: string
  active: boolean
  sets_target: number
  reps_target: string
  weight_target: number | null
  rest_seconds: number | null
  sort_order: number
  last_weight: number | null
}

export interface TodayContext {
  local_date: string
  is_rest_day: boolean
  exercises: TodayContextExercise[]
  rotation: UserRotation | null
  flex_days: string[]
  last_completion: { day: string; completed_at: string } | null
}

export interface TodayExercise {
  id: string
  name: string
  sets: number
  /** Lower (or only) bound of the target reps; null when the target isn't a number ("AMRAP"). */
  reps: number | null
  /** Upper bound when the target is a range ("8-12" → 12), else null. */
  reps_max: number | null
  /** In `unit`, rounded to 0.1. Null = no target and no history. */
  weight: number | null
  /** Seconds the plan calls for after a working set; null = device default. */
  rest: number | null
}

export type TodayPayload =
  | {
      date: string
      unit: 'lbs' | 'kg'
      workout: { id: string; name: string; exercises: TodayExercise[] }
    }
  | { date: string; unit: 'lbs' | 'kg'; workout: null; reason: 'rest_day' | 'no_plan' }

/** "8-12" → [8, 12], "10" → [10, null], "AMRAP" → [null, null]. */
export function parseRepsTarget(raw: string | null | undefined): [number | null, number | null] {
  const m = /(\d+)(?:\s*[-–—]\s*(\d+))?/.exec(raw ?? '')
  if (!m) return [null, null]
  const lo = Number(m[1])
  const hi = m[2] !== undefined ? Number(m[2]) : null
  return [lo, hi !== null && hi !== lo ? hi : null]
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export function buildTodayPayload(ctx: TodayContext, unit: 'lbs' | 'kg'): TodayPayload {
  if (ctx.is_rest_day) return { date: ctx.local_date, unit, workout: null, reason: 'rest_day' }

  const state = rotationStateFrom({
    exerciseRows: ctx.exercises,
    rotation: ctx.rotation,
    flexDays: ctx.flex_days,
    lastCompletion: ctx.last_completion
      ? { day: ctx.last_completion.day, completedAt: ctx.last_completion.completed_at }
      : null,
  })
  // Same fallback as Home: an empty rotation still offers the first day.
  const day = state.nextDay ?? [...state.dayKeys].sort()[0] ?? null
  if (!day) return { date: ctx.local_date, unit, workout: null, reason: 'no_plan' }

  const exercises = ctx.exercises
    .filter(e => e.day_type === day && e.active !== false)
    .sort((a, b) => a.sort_order - b.sort_order)
    .slice(0, MAX_TODAY_EXERCISES)
    .map((e): TodayExercise => {
      const [reps, repsMax] = parseRepsTarget(e.reps_target)
      // Canonical lbs; same prefill order as a live web workout.
      const lbs = e.weight_target ?? e.last_weight
      return {
        id: e.id,
        name: e.name.length > MAX_NAME_CHARS ? e.name.slice(0, MAX_NAME_CHARS - 1) + '…' : e.name,
        sets: e.sets_target,
        reps,
        reps_max: repsMax,
        weight: lbs == null ? null : round1(unit === 'kg' ? Number(lbs) / LBS_PER_KG : Number(lbs)),
        rest: e.rest_seconds ?? null,
      }
    })

  return {
    date: ctx.local_date,
    unit,
    workout: { id: day, name: formatDayType(day), exercises },
  }
}
