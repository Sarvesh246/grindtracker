import { z } from 'zod'

/**
 * Request validation for /api/watch/v1. Bounds are generous for real lifting
 * and tight enough that a corrupt or hostile payload can't do much: they are
 * documented in docs/watch-api.md, so change both together.
 */

export const MAX_SETS_PER_REQUEST = 200
export const MAX_BODY_BYTES = 64 * 1024
/** How far ahead of the server clock a device timestamp may be (clock skew). */
export const FUTURE_SKEW_MS = 5 * 60_000
/** Matches grind_safe_past_date's 730-day floor. */
export const MAX_AGE_MS = 730 * 86_400_000

const isoUtc = z.iso.datetime({ offset: true, message: 'must be an ISO 8601 timestamp, e.g. 2026-11-16T18:04:05Z' })
const uuid = z.uuid({ message: 'must be a UUID' })

export const watchSetSchema = z.strictObject({
  id: uuid,
  exercise_id: uuid,
  set_number: z.int().min(1).max(100),
  reps: z.int().min(0).max(1000),
  weight: z.number().min(0).max(2000),
  unit: z.enum(['lbs', 'kg']),
  completed_at: isoUtc,
  rest_seconds: z.int().min(0).max(3600).nullish(),
  is_warmup: z.boolean().optional(),
})

export const watchSessionSchema = z
  .strictObject({
    id: uuid,
    workout_id: z.string().trim().min(1).max(64).nullish(),
    started_at: isoUtc,
    ended_at: isoUtc.nullish(),
    /** The device's UTC offset in seconds (Garmin `System.getClockTime().timeZoneOffset`). */
    utc_offset_seconds: z.int().min(-14 * 3600).max(14 * 3600).nullish(),
    heart_rate: z
      .strictObject({
        avg: z.int().min(20).max(250).nullish(),
        max: z.int().min(20).max(250).nullish(),
      })
      .nullish(),
    calories: z.int().min(0).max(20000).nullish(),
    sets: z.array(watchSetSchema).max(MAX_SETS_PER_REQUEST).default([]),
  })
  .superRefine((s, ctx) => {
    const ids = new Set<string>()
    const slots = new Set<string>()
    s.sets.forEach((set, i) => {
      if (ids.has(set.id)) {
        ctx.addIssue({ code: 'custom', path: ['sets', i, 'id'], message: 'duplicate set id in this request' })
      }
      ids.add(set.id)
      const slot = `${set.exercise_id}:${set.set_number}`
      if (slots.has(slot)) {
        ctx.addIssue({
          code: 'custom',
          path: ['sets', i, 'set_number'],
          message: 'two sets in this request share an exercise_id and set_number',
        })
      }
      slots.add(slot)
    })
    if (s.ended_at && Date.parse(s.ended_at) < Date.parse(s.started_at)) {
      ctx.addIssue({ code: 'custom', path: ['ended_at'], message: 'must not be before started_at' })
    }
  })

export type WatchSessionInput = z.infer<typeof watchSessionSchema>

/** Timestamp sanity against the server clock. Separate from the schema so it
 *  can take `now` (tests) and so the schema stays a pure shape check. */
export function timestampIssues(input: WatchSessionInput, now: number): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = []
  const check = (path: string, iso: string | null | undefined) => {
    if (!iso) return
    const t = Date.parse(iso)
    if (t > now + FUTURE_SKEW_MS) issues.push({ path, message: 'is in the future' })
    else if (t < now - MAX_AGE_MS) issues.push({ path, message: 'is more than 730 days old' })
  }
  check('started_at', input.started_at)
  check('ended_at', input.ended_at)
  input.sets.forEach((set, i) => check(`sets.${i}.completed_at`, set.completed_at))
  return issues
}

export const todayQuerySchema = z.strictObject({
  date: z.iso.date({ message: 'must be YYYY-MM-DD' }).optional(),
  utc_offset_seconds: z.coerce.number().int().min(-14 * 3600).max(14 * 3600).optional(),
  unit: z.enum(['lbs', 'kg']).optional(),
})

/** Zod issues as `{ path, message }`, path dotted (`sets.2.reps`). */
export function formatIssues(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map(issue => ({
    path: issue.path.map(String).join('.') || '(root)',
    message: issue.message,
  }))
}
