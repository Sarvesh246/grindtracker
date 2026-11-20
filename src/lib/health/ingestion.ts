import { z } from 'zod'
import { validDate } from './model'

const timestamp = z.iso.datetime({ offset: true })
const source = z.enum([
  'connect_iq',
  'garmin_personal',
  'garmin_business',
  'garmin_export',
  'garmin_unofficial',
  'apple_health'
])
const stage = z
  .object({ stage: z.enum(['awake', 'rem', 'light', 'deep']), start: timestamp, end: timestamp })
  .strict()
const date = z.string().refine(validDate, 'Expected a real calendar date')
/** Most stage intervals a night may carry; importers drop a longer timeline and keep the totals. */
export const MAX_STAGE_INTERVALS = 1500
const nullableNumber = (min: number, max: number) =>
  z.number().finite().min(min).max(max).nullable()
const units = {
  heart_rate: ['bpm', 20, 250],
  body_battery: ['score', 0, 100],
  stress: ['score', 0, 100],
  steps: ['steps', 0, 200000],
  resting_hr: ['bpm', 20, 150],
  hrv: ['ms', 1, 500],
  respiration: ['breaths/min', 1, 80],
  spo2: ['percent', 50, 100],
  recovery_hours: ['hours', 0, 200]
} as const
const sampleSchema = z
  .object({
    provider_id: z.string().min(1).max(160),
    metric: z.enum(Object.keys(units) as [keyof typeof units, ...(keyof typeof units)[]]),
    start_at: timestamp,
    end_at: timestamp,
    observed_at: timestamp,
    revision_at: timestamp,
    value: z.number().finite().nullable(),
    unit: z.string().max(24),
    kind: z.enum(['point', 'average', 'total']),
    quality: z.enum(['current', 'partial', 'unavailable'])
  })
  .strict()
  .superRefine((s, ctx) => {
    const [unit, min, max] = units[s.metric]
    if (s.unit !== unit || (s.value != null && (s.value < min || s.value > max)))
      ctx.addIssue({ code: 'custom', message: 'Metric unit or value is invalid' })
    if (Date.parse(s.end_at) < Date.parse(s.start_at))
      ctx.addIssue({ code: 'custom', message: 'Interval ends before it starts' })
  })
export const sleepSchema = z
  .object({
    provider_id: z.string().min(1).max(160),
    wake_date: date,
    provider_date: date,
    timezone: z.string().min(1).max(80),
    start_at: timestamp,
    end_at: timestamp,
    kind: z.enum(['main', 'nap']),
    duration_seconds: z.number().int().min(0).max(86400),
    score: nullableNumber(0, 100),
    stages: z.array(stage).max(MAX_STAGE_INTERVALS).nullable(),
    stage_totals: z
      .object({
        awake: z.number().int().min(0).max(86400).optional(),
        rem: z.number().int().min(0).max(86400).optional(),
        light: z.number().int().min(0).max(86400).optional(),
        deep: z.number().int().min(0).max(86400).optional()
      })
      .strict()
      .nullable(),
    overnight_hrv: nullableNumber(1, 500),
    respiration: nullableNumber(1, 80),
    spo2: nullableNumber(50, 100),
    revision_at: timestamp,
    status: z.enum(['final', 'provisional', 'unknown'])
  })
  .strict()
  .superRefine((s, ctx) => {
    const start = Date.parse(s.start_at),
      end = Date.parse(s.end_at)
    if (end <= start || end - start > 86400000 || s.duration_seconds * 1000 > end - start)
      ctx.addIssue({ code: 'custom', message: 'Invalid sleep duration or interval' })
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: s.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(new Date(s.end_at))
      const part = (type: string) => parts.find((p) => p.type === type)?.value
      if (`${part('year')}-${part('month')}-${part('day')}` !== s.wake_date)
        ctx.addIssue({ code: 'custom', message: 'Wake date does not match the source timezone' })
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Invalid source timezone' })
    }
    let previous = start
    for (const interval of s.stages ?? []) {
      const from = Date.parse(interval.start),
        to = Date.parse(interval.end)
      if (from < previous || to <= from || from < start || to > end)
        ctx.addIssue({
          code: 'custom',
          message: 'Sleep stages overlap or fall outside the sleep interval'
        })
      previous = to
    }
    const total = Object.values(s.stage_totals ?? {}).reduce((n, v) => n + v, 0)
    if (total * 1000 > end - start)
      ctx.addIssue({ code: 'custom', message: 'Stage totals exceed time in bed' })
  })
const healthBatchSchema = z
  .object({
    version: z.literal(1),
    batch_id: z.uuid(),
    generation: z.number().int().nonnegative(),
    source,
    captured_at: timestamp,
    samples: z.array(sampleSchema).max(256),
    sleeps: z.array(sleepSchema).max(14)
  })
  .strict()
  .superRefine((batch, ctx) => {
    const identities = new Set<string>()
    for (const sample of batch.samples) {
      const id = `${sample.metric}:${sample.provider_id}`
      if (identities.has(id))
        ctx.addIssue({ code: 'custom', message: 'Duplicate sample identity in batch' })
      identities.add(id)
    }
    const sleeps = new Set<string>()
    for (const sleep of batch.sleeps) {
      if (sleeps.has(sleep.provider_id))
        ctx.addIssue({ code: 'custom', message: 'Duplicate sleep identity in batch' })
      sleeps.add(sleep.provider_id)
    }
  })

export function validateHealthBatch(input: unknown, now: Date, watch = false) {
  return healthBatchSchema
    .superRefine((batch, ctx) => {
      if (watch && (batch.source !== 'connect_iq' || batch.sleeps.length))
        ctx.addIssue({ code: 'custom', message: 'Watch batches cannot claim cloud sleep records' })
      const earliest = now.getTime() - 180 * 86400000,
        latest = now.getTime() + 5 * 60000
      const times = [
        batch.captured_at,
        ...batch.samples.flatMap((s) => [s.start_at, s.end_at, s.observed_at, s.revision_at]),
        ...batch.sleeps.flatMap((s) => [s.start_at, s.end_at, s.revision_at])
      ]
      if (times.some((t) => Date.parse(t) < earliest || Date.parse(t) > latest))
        ctx.addIssue({
          code: 'custom',
          message: 'Measurements must be within 180 days and not in the future'
        })
    })
    .safeParse(input)
}
