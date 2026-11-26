import { z } from 'zod'

/**
 * Request validation for /api/watch/v1. Bounds are generous for real lifting
 * and tight enough that a corrupt or hostile payload can't do much: they are
 * documented in docs/watch-api.md, so change both together.
 */

const MAX_SETS_PER_REQUEST = 200
export const MAX_BODY_BYTES = 64 * 1024
/** How far ahead of the server clock a device timestamp may be (clock skew). */
const FUTURE_SKEW_MS = 5 * 60_000
/** Matches grind_safe_past_date's 730-day floor. */
const MAX_AGE_MS = 730 * 86_400_000

const isoUtc = z.iso.datetime({ offset: true, message: 'must be an ISO 8601 timestamp, e.g. 2026-11-16T18:04:05Z' })
const uuid = z.uuid({ message: 'must be a UUID' })

const watchSetSchema = z.strictObject({
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

/** 12 hours at one reading a second (migration 70; 59 allowed 8,640). */
const MAX_HR_TRACE = 43_200
/** Base64 of MAX_HR_TRACE bytes. */
const MAX_TRACE_B64 = Math.ceil(MAX_HR_TRACE / 3) * 4

const watchHrSchema = z.strictObject({
  /** One reading every `step` seconds from started_at; 0 = no reading. */
  trace: z.array(z.int().min(0).max(250)).max(MAX_HR_TRACE).optional(),
  /** The same trace as one byte a reading, base64: a 1 s trace as JSON
   *  numbers is too big a request for the watch. Wins over `trace`. */
  trace_b64: z.string().max(MAX_TRACE_B64).regex(/^[A-Za-z0-9+/]*={0,2}$/).optional(),
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
    batch_upload: z.boolean().optional(),
    saved_upload: z.literal(true).optional(),
    expected_sets: z.int().min(1).max(512).optional(),
    sensor_retry: z.boolean().optional(),
    sets: z.array(watchSetSchema).max(MAX_SETS_PER_REQUEST).default([]),
  })
  .superRefine((s, ctx) => {
    if (s.expected_sets !== undefined && (!s.saved_upload || !s.ended_at || s.expected_sets < s.sets.length)) {
      ctx.addIssue({ code: 'custom', path: ['expected_sets'], message: 'expected_sets requires a final saved workout batch' })
    }
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
  /** Migration 71. The live respiration rate, breaths per minute, placed at
   *  `bucket` on the day's curve. */
  respiration: z.int().min(4).max(60).nullish(),
  /** Migration 72. The watch's wrist temperature, °C, placed at `bucket`. */
  temperature: z.number().min(0).max(50).nullish(),
  /** All-day heart rate, bucket averages (migration 69). */
  heart_rate: z.array(z.int().min(25).max(250).nullable()).length(96).optional(),
  /** The 15-min bucket (0–95, local) this snapshot was taken in; the running
   *  totals (steps, active minutes, floors) are placed there on the day's curve. */
  bucket: z.int().min(0).max(95).optional(),
  /** `background`: sent by the watch's background service with the app closed. */
  source: z.enum(['app', 'background']).optional(),
  /** Migration 70. Every all-day HR sample the watch stored since its last
   *  sync, unaveraged: seconds from local midnight and bpm, same length.
   *  Diagnostics never fail the snapshot: a bad value drops this key (`catch`),
   *  not the day. */
  hr_raw: z
    .strictObject({
      t: z.array(z.int().min(-86_400).max(86_400)).max(480),
      v: z.array(z.int().min(25).max(250)).max(480),
    })
    .refine(r => r.t.length === r.v.length, { message: 't and v must be the same length' })
    .optional()
    .catch(undefined),
  /** Migration 70. The watch itself, for understanding it: never shown. */
  diag: z
    .strictObject({
      taken_at: isoUtc,
      battery: z.int().min(0).max(100).nullish(),
      charging: z.boolean().nullish(),
      free_mem: z.int().min(0).max(100_000_000).nullish(),
      total_mem: z.int().min(0).max(100_000_000).nullish(),
      part: z.string().max(32).nullish(),
      fw: z.string().max(32).nullish(),
      ciq: z.string().max(32).nullish(),
      app_version: z.string().max(32).nullish(),
      /** The previous background run: when, and its HTTP code (-1: threw, 0: skipped). */
      prev_bg_at: isoUtc.nullish(),
      prev_bg_code: z.int().min(-1000).max(1000).nullish(),
      /** The background event period, seconds. */
      period_s: z.int().min(0).max(86_400).nullish(),
      /** The last saved workout segment's heart-rate reads: [reads, misses,
       *  from the recording, from the sensor fallback]. */
      wk_hr: z.tuple([z.int().min(0), z.int().min(0), z.int().min(0), z.int().min(0)]).nullish(),
      wk_hr_at: isoUtc.nullish(),
      /** Per sensor value: [value, age in minutes], or a code: -1 empty,
       *  -2 threw, -3 not on this firmware. */
      probe: z
        // A sample stamped ahead of the watch clock (the clock was stepped back)
        // has a negative age. It is current, so it is clamped to 0, not rejected.
        .record(z.string().max(16), z.union([z.tuple([z.number(), z.int().min(-100_000).max(100_000).transform(age => Math.max(0, age))]), z.int().min(-3).max(-1)]))
        .refine(r => Object.keys(r).length <= 24, { message: 'at most 24 probes' })
        .optional(),
    })
    .optional()
    .catch(undefined),
})

export type WatchDailyInput = z.infer<typeof watchDailySchema>

/** The counter's rolling motion window: 75 s at 12.5 Hz. */
const MAX_REP_LAB_SAMPLES = 938
const milliG = z.int().min(-16_000).max(16_000)

/** POST /rep-lab: one set recorded for tuning the wrist rep counter
 *  (migration 66). A full recording carries the motion arrays; a correction
 *  made later through Undo carries only `id` and `logged_reps`. */
/** int16 big-endian samples, base64: at most `max` samples per axis. */
const b64Bytes = (s: string) => (s.length / 4) * 3 - (s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0)
const i16b64 = (max: number) => z.string()
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/, 'must be base64')
  .refine(s => b64Bytes(s) % 2 === 0 && b64Bytes(s) <= 2 * max, { message: `must hold at most ${max} int16 samples` })

/** Shared by both recording formats. */
const repLabMeta = {
  id: uuid,
  session_id: uuid,
  exercise_id: z.string().max(64).nullish(),
  exercise_name: z.string().max(120).nullish(),
  set_number: z.int().min(1).max(100).nullish(),
  weight: z.number().min(0).max(2000).nullish(),
  unit: z.enum(['lbs', 'kg']).nullish(),
  logged_reps: z.int().min(0).max(1000),
  auto_reps: z.int().min(0).max(1000).nullish(),
  auto_shown: z.boolean(),
  typed: z.boolean(),
  started_at: isoUtc.nullish(),
  finished_at: isoUtc.nullish(),
  rate_hz: z.number().min(1).max(100),
  clipped: z.boolean(),
  /** Counter timeline: [ms since START, kind, a, b, c, d]. */
  events: z.array(z.array(z.number()).max(6)).max(120).nullish(),
  diag: z.record(z.string().max(32), z.union([z.string().max(200), z.number(), z.boolean(), z.null()])).nullish(),
  app_version: z.string().max(32).nullish(),
}

/** The tape format (watch builds from 2026-11-18b): each axis one base64
 *  string of int16, plus compass, heart rate, beat intervals and step marks. */
const watchRepLabTapeSchema = z.strictObject({
  ...repLabMeta,
  enc: z.literal('i16b64'),
  ax: i16b64(MAX_REP_LAB_SAMPLES),
  ay: i16b64(MAX_REP_LAB_SAMPLES),
  az: i16b64(MAX_REP_LAB_SAMPLES),
  mx: i16b64(MAX_REP_LAB_SAMPLES).nullish(),
  my: i16b64(MAX_REP_LAB_SAMPLES).nullish(),
  mz: i16b64(MAX_REP_LAB_SAMPLES).nullish(),
  /** Heart rate per sensor batch (about 1 s), 0 = no reading. */
  hr: z.array(z.int().min(0).max(255)).max(100).nullish(),
  /** Milliseconds between heartbeats. */
  beats: z.array(z.int().min(0).max(5000)).max(240).nullish(),
  /** [accelerometer sample index since START, steps since START] per batch. */
  step_marks: z.array(z.tuple([z.int().min(0).max(100_000), z.int().min(0).max(10_000)])).max(100).nullish(),
  /** The compass and beat intervals were dropped to get the record through. */
  slim: z.boolean().nullish(),
}).refine(v => v.ax.length === v.ay.length && v.ay.length === v.az.length, { message: 'ax, ay and az must be the same length', path: ['ax'] })
  .refine(v => v.mx == null || (v.mx.length === (v.my ?? '').length && v.mx.length === (v.mz ?? '').length), { message: 'mx, my and mz must be the same length', path: ['mx'] })

export const watchRepLabSchema = z.union([
  watchRepLabTapeSchema,
  z.strictObject({
    id: uuid,
    session_id: uuid,
    exercise_id: z.string().max(64).nullish(),
    exercise_name: z.string().max(120).nullish(),
    set_number: z.int().min(1).max(100).nullish(),
    weight: z.number().min(0).max(2000).nullish(),
    unit: z.enum(['lbs', 'kg']).nullish(),
    logged_reps: z.int().min(0).max(1000),
    auto_reps: z.int().min(0).max(1000).nullish(),
    auto_shown: z.boolean(),
    typed: z.boolean(),
    started_at: isoUtc.nullish(),
    finished_at: isoUtc.nullish(),
    rate_hz: z.number().min(1).max(100),
    clipped: z.boolean(),
    x: z.array(milliG).max(MAX_REP_LAB_SAMPLES),
    y: z.array(milliG).max(MAX_REP_LAB_SAMPLES),
    z: z.array(milliG).max(MAX_REP_LAB_SAMPLES),
    steps: z.array(z.int().min(0).max(10_000)).max(MAX_REP_LAB_SAMPLES).nullish(),
    /** Counter timeline: [ms since START, kind, a, b, c, d]. */
    events: z.array(z.array(z.number()).max(6)).max(120).nullish(),
    diag: z.record(z.string().max(32), z.union([z.string().max(200), z.number(), z.boolean(), z.null()])).nullish(),
    app_version: z.string().max(32).nullish(),
  }).refine(v => v.x.length === v.y.length && v.y.length === v.z.length, { message: 'x, y and z must be the same length', path: ['x'] }),
  z.strictObject({
    id: uuid,
    logged_reps: z.int().min(0).max(1000),
    corrected: z.literal(true),
  }),
])

export type WatchRepLabInput = z.infer<typeof watchRepLabSchema>

const telemetryValue = z.union([
  z.string().max(200), z.number(), z.boolean(), z.null(), z.array(z.number()).max(20),
])

/** POST /telemetry: app health from the watch (migration 67). `unclean_exit`
 *  is a run that never stopped cleanly (a crash, a flat battery, a reboot),
 *  reported on the next start with what the app was doing; `session` is one
 *  saved workout's battery, memory, counter timing and upload outcomes. */
export const watchTelemetrySchema = z.strictObject({
  id: uuid,
  kind: z.enum(['unclean_exit', 'session']),
  at: isoUtc.nullish(),
  app_version: z.string().max(32).nullish(),
  data: z.record(z.string().max(32), telemetryValue).refine(d => Object.keys(d).length <= 40, { message: 'at most 40 fields' }),
})

/** POST /readiness: one morning HRV check (migration 68). The server
 *  recomputes everything from `rr_ms`; `watch_rmssd` is only what the watch
 *  showed, kept to check the two agree. */
export const watchReadinessSchema = z.strictObject({
  id: uuid,
  local_date: z.iso.date({ message: 'must be YYYY-MM-DD' }),
  measured_at: isoUtc,
  duration_s: z.int().min(10).max(600),
  /** Beat-to-beat intervals in ms, as delivered (artifacts included). */
  rr_ms: z.array(z.int().min(0).max(5000)).min(1).max(600),
  /** Seconds the watch saw the wrist move during the check. */
  moving_s: z.int().min(0).max(600).optional(),
  watch_rmssd: z.number().min(0).max(1000).nullish(),
  app_version: z.string().max(32).nullish(),
})

/** Zod issues as `{ path, message }`, path dotted (`sets.2.reps`). */
export function formatIssues(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map(issue => ({
    path: issue.path.map(String).join('.') || '(root)',
    message: issue.message,
  }))
}
