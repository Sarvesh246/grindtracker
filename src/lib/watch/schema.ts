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
  // GRIND Body (migration 59). Heart rate the watch saw for this set: its peak,
  // the reading when it was logged, and how far it fell 60 s into the rest.
  hr_peak: z.int().min(20).max(250).nullish(),
  hr_end: z.int().min(20).max(250).nullish(),
  hr_rest_drop_60: z.int().min(-100).max(200).nullish(),
})

/** 2 hours at one sample per 5 s is 1,440; this allows a 12-hour session. */
export const MAX_HR_TRACE = 8640

export const watchHrSchema = z.strictObject({
  /** One reading every `step` seconds from started_at; 0 = no reading. */
  trace: z.array(z.int().min(0).max(250)).max(MAX_HR_TRACE).optional(),
  step: z.int().min(1).max(60).optional(),
  /** Zone floors z1..z5 and max, from the user's watch profile. */
  zones: z.array(z.int().min(20).max(250)).min(5).max(6).optional(),
  zone_seconds: z.array(z.int().min(0).max(86_400)).length(5).optional(),
  training_effect: z.number().min(0).max(5).optional(),
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
    hr: watchHrSchema.nullish(),
    sets:z.array(watchSetSchema).max(MAX_SETS_PER_REQUEST).default([]),
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
  /** A day id from `days`, to get that day's exercises instead of the up-next one. */
  day: z.string().min(1).max(64).optional(),
})

const bucketSeries = z.array(z.int().min(0).max(100).nullable()).length(96)

/** POST /daily: the watch's snapshot of the day so far. Series are 96 buckets
 *  of 15 minutes from local midnight, null where the watch had no reading. */
export const watchDailySchema = z.strictObject({
  date: z.iso.date({ message: 'must be YYYY-MM-DD' }),
  body_battery: bucketSeries.optional(),
  stress: bucketSeries.optional(),
  /** The current Body Battery, when it is newer than the last bucket. */
  body_battery_now: z.int().min(0).max(100).nullish(),
  resting_hr: z.int().min(20).max(150).nullish(),
  recovery_hours: z.int().min(0).max(200).nullish(),
  steps: z.int().min(0).max(200_000).nullish(),
  active_minutes: z.int().min(0).max(1440).nullish(),
  floors: z.int().min(0).max(2000).nullish(),
  spo2: z.int().min(50).max(100).nullish(),
  vo2max: z.int().min(10).max(100).nullish(),
})

export type WatchDailyInput = z.infer<typeof watchDailySchema>

/** Zod issues as `{ path, message }`, path dotted (`sets.2.reps`). */
export function formatIssues(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map(issue => ({
    path: issue.path.map(String).join('.') || '(root)',
    message: issue.message,
  }))
}
