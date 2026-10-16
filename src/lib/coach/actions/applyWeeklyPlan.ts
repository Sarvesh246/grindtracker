import type { SupabaseClient } from '@supabase/supabase-js'
import { enabledDayKeys } from '@/lib/utils/dayKeys'
import { dayOfWeekFromDateKey, DOW_LABELS, parseDayOfWeek } from './dates'
import { validateCreateDayInput } from './createDay'
import { insertCoachProposal } from './proposals'
import { normalizeName } from './resolveExercise'
import { mapCoachRpcError } from './rpcErrors'
import { COACH_PROPOSAL_INSERT_FAILED } from './types'
import type {
  ApplyWeeklyPlanExecutePayload,
  CoachActionPayload,
  CoachProposalView,
  WeeklyPlanDay,
} from './types'

export type WeeklyPlanDayInput = {
  dayKey: string
  weekday: string | number
  category?: string | null
  exercises: {
    name: string
    sets_target: number
    reps_target: string
    rest_seconds?: number | null
    weight_target_lbs?: number | null
  }[]
}

const MAX_PLAN_DAYS = 7

function normalizeDayKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Monday-first rank so a week reads Mon…Sun. */
function weekRank(dow: number): number {
  return (dow + 6) % 7
}

function fmtRest(seconds: number | null): string {
  if (seconds == null) return ''
  if (seconds % 60 === 0) return ` · ${seconds / 60} min rest`
  if (seconds > 60) return ` · ${Math.floor(seconds / 60)}m${seconds % 60}s rest`
  return ` · ${seconds}s rest`
}

export function validateWeeklyPlanInput(input: {
  days: WeeklyPlanDayInput[]
  restWeekdays?: (string | number)[] | null
}):
  | {
      ok: true
      days: WeeklyPlanDay[]
      restWeekdays: number[]
    }
  | { ok: false; reason: string } {
  if (!Array.isArray(input.days) || input.days.length === 0) {
    return { ok: false, reason: 'The plan needs at least one training day.' }
  }
  if (input.days.length > MAX_PLAN_DAYS) {
    return { ok: false, reason: `A week has at most ${MAX_PLAN_DAYS} training days.` }
  }

  const days: WeeklyPlanDay[] = []
  const seenWeekdays = new Set<number>()
  const seenKeys = new Set<string>()
  for (const raw of input.days) {
    const weekday = parseDayOfWeek(raw.weekday)
    if (weekday == null) {
      return {
        ok: false,
        reason: `"${raw.dayKey}" needs a weekday (Sunday–Saturday).`,
      }
    }
    if (seenWeekdays.has(weekday)) {
      return {
        ok: false,
        reason: `Two plan days are on ${DOW_LABELS[weekday]}. One workout per weekday.`,
      }
    }
    seenWeekdays.add(weekday)

    const validated = validateCreateDayInput({
      dayKey: raw.dayKey,
      category: raw.category ?? null,
      flex: false,
      exercises: raw.exercises,
    })
    if (!validated.ok) {
      return { ok: false, reason: `${raw.dayKey}: ${validated.reason}` }
    }
    if (seenKeys.has(validated.dayKey)) {
      return { ok: false, reason: `Day name "${validated.dayKey}" is used twice.` }
    }
    seenKeys.add(validated.dayKey)

    days.push({
      dayKey: validated.dayKey,
      weekday,
      category: validated.category,
      exercises: validated.exercises.map((e, i) => {
        const rest = Number(raw.exercises[i]?.rest_seconds)
        return {
          name: e.name,
          sets_target: e.sets_target,
          reps_target: e.reps_target,
          weight_target_lbs: e.weight_target_lbs ?? null,
          rest_seconds:
            Number.isFinite(rest) && rest > 0 ? Math.min(3600, Math.round(rest)) : null,
        }
      }),
    })
  }

  const restWeekdays: number[] = []
  for (const r of input.restWeekdays ?? []) {
    const dow = parseDayOfWeek(r)
    if (dow == null) {
      return { ok: false, reason: `"${r}" is not a weekday.` }
    }
    if (seenWeekdays.has(dow)) {
      return {
        ok: false,
        reason: `${DOW_LABELS[dow]} has a workout, so it can't also be a rest day.`,
      }
    }
    if (!restWeekdays.includes(dow)) restWeekdays.push(dow)
  }

  return { ok: true, days, restWeekdays }
}

type ExerciseRow = {
  id: string
  name: string
  day_type: string
  active: boolean
}

export async function previewApplyWeeklyPlan(
  supabase: SupabaseClient,
  args: {
    userId: string
    conversationId: string | null
    days: WeeklyPlanDayInput[]
    restWeekdays?: (string | number)[] | null
    keepDays?: string[] | null
    localDate: string
  },
): Promise<
  | { ok: true; proposal: CoachProposalView }
  | { ok: false; reason: string }
> {
  const validated = validateWeeklyPlanInput(args)
  if (!validated.ok) return validated

  const [{ data: exerciseRows }, { data: restRows }] = await Promise.all([
    supabase
      .from('exercises')
      .select('id, name, day_type, active')
      .eq('user_id', args.userId),
    supabase
      .from('user_rest_days')
      .select('day_of_week')
      .eq('user_id', args.userId)
      .is('effective_until', null),
  ])
  const existing = (exerciseRows ?? []) as ExerciseRow[]
  const existingKeys = [...new Set(existing.map(e => e.day_type))]
  const enabledKeys = enabledDayKeys(existing)

  // Resolve days the user wants left alone ("besides home abs and the normal abs").
  const keep = new Set<string>()
  for (const raw of args.keepDays ?? []) {
    const want = normalizeDayKey(raw)
    if (!want) continue
    const exact = existingKeys.find(k => normalizeDayKey(k) === want)
    if (exact) {
      keep.add(exact)
      continue
    }
    const partial = existingKeys.filter(k => normalizeDayKey(k).includes(want))
    if (partial.length === 1) {
      keep.add(partial[0]!)
    } else {
      return {
        ok: false,
        reason:
          partial.length > 1
            ? `"${raw}" matches several days (${partial.join(', ')}). Use the exact name.`
            : `No existing day named "${raw}". Your days: ${existingKeys.join(', ') || '(none)'}.`,
      }
    }
  }

  const planKeys = new Set(validated.days.map(d => d.dayKey))
  const hideDays = enabledKeys.filter(
    k => !planKeys.has(k) && !keep.has(k),
  )

  // Rotation: Mon→Sun loop, pointer set so "up next" is the first planned
  // workout on or after today's weekday (today's, if it hasn't been trained).
  const ordered = [...validated.days].sort(
    (a, b) => weekRank(a.weekday) - weekRank(b.weekday),
  )
  const sequence = ordered.map(d => d.dayKey)
  const todayDow = dayOfWeekFromDateKey(args.localDate)
  let nextIdx = 0
  if (todayDow >= 0) {
    const todayRank = weekRank(todayDow)
    const hit = ordered.findIndex(d => weekRank(d.weekday) >= todayRank)
    nextIdx = hit >= 0 ? hit : 0
  }
  const currentIndex = nextIdx - 1

  // Rest weekdays: enable the plan's, drop any existing one that now has a workout.
  const activeRest = new Set(
    ((restRows ?? []) as { day_of_week: number }[]).map(r => r.day_of_week),
  )
  const trainingDows = new Set(validated.days.map(d => d.weekday))
  const restWeekdaysEnable = validated.restWeekdays.filter(d => !activeRest.has(d))
  const restWeekdaysDisable = [...activeRest].filter(d => trainingDows.has(d))

  const execute: ApplyWeeklyPlanExecutePayload = {
    days: validated.days,
    hideDays,
    sequence,
    currentIndex,
    restWeekdaysEnable,
    restWeekdaysDisable,
    localDate: args.localDate,
  }

  const setsTotal = (d: WeeklyPlanDay) =>
    d.exercises.reduce((n, e) => n + e.sets_target, 0)
  const summaryLines = ordered.map(
    d =>
      `${DOW_LABELS[d.weekday]} · ${d.dayKey} — ${d.exercises.length} exercises, ${setsTotal(d)} sets`,
  )
  if (validated.restWeekdays.length > 0) {
    summaryLines.push(
      `Rest: ${validated.restWeekdays
        .sort((a, b) => weekRank(a) - weekRank(b))
        .map(d => DOW_LABELS[d])
        .join(', ')}`,
    )
  }
  summaryLines.push(
    hideDays.length > 0
      ? `Hides (not deleted): ${hideDays.join(', ')}`
      : 'Hides: nothing',
  )
  if (keep.size > 0) summaryLines.push(`Keeps as-is: ${[...keep].join(', ')}`)

  const payload: CoachActionPayload = {
    kind: 'apply_weekly_plan',
    card: {
      title: 'Replace my training week',
      summaryLines,
      riskNote:
        'Old days are only hidden — their exercises and history stay, and you can turn them back on in Log → Manage. Workout order becomes this week, starting from the next planned day.',
      steps: ordered.map(
        d =>
          `${d.dayKey} (${DOW_LABELS[d.weekday]}): ${d.exercises
            .map(e => `${e.name} ${e.sets_target}×${e.reps_target}${fmtRest(e.rest_seconds)}`)
            .join('; ')}`,
      ),
    },
    execute,
  }

  const proposal = await insertCoachProposal(supabase, {
    userId: args.userId,
    conversationId: args.conversationId,
    payload,
  })
  if (!proposal) return { ok: false, reason: COACH_PROPOSAL_INSERT_FAILED }
  return { ok: true, proposal }
}

export async function executeApplyWeeklyPlan(
  supabase: SupabaseClient,
  args: { userId: string } & ApplyWeeklyPlanExecutePayload,
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const warnings: string[] = []
  const planKeys = args.days.map(d => d.dayKey)

  const { data: existingRows, error: readError } = await supabase
    .from('exercises')
    .select('id, name, day_type, active')
    .eq('user_id', args.userId)
    .in('day_type', planKeys)
  if (readError) return { ok: false, message: readError.message }
  const existing = (existingRows ?? []) as ExerciseRow[]

  let exerciseCount = 0
  for (const day of args.days) {
    const mine = existing.filter(e => e.day_type === day.dayKey)
    const byName = new Map(mine.map(e => [normalizeName(e.name), e]))
    const matched = new Set<string>()
    const inserts: Record<string, unknown>[] = []

    for (let i = 0; i < day.exercises.length; i++) {
      const ex = day.exercises[i]!
      const hit = byName.get(normalizeName(ex.name))
      const fields = {
        sets_target: ex.sets_target,
        reps_target: ex.reps_target,
        rest_seconds: ex.rest_seconds,
        sort_order: i + 1,
        active: true,
        ...(ex.weight_target_lbs != null ? { weight_target: ex.weight_target_lbs } : {}),
      }
      if (hit && !matched.has(hit.id)) {
        matched.add(hit.id)
        const { error } = await supabase.from('exercises').update(fields).eq('id', hit.id)
        if (error) return { ok: false, message: `${day.dayKey}: ${error.message}` }
      } else {
        inserts.push({
          user_id: args.userId,
          name: ex.name,
          day_type: day.dayKey,
          weight_target: ex.weight_target_lbs,
          ...fields,
        })
      }
    }

    if (inserts.length > 0) {
      const { error } = await supabase.from('exercises').insert(inserts)
      if (error) return { ok: false, message: `${day.dayKey}: ${error.message}` }
    }

    // Anything the old version of this day had that the plan dropped: hide it
    // (history and PR bars stay attached to the row).
    const dropped = mine.filter(e => !matched.has(e.id)).map(e => e.id)
    if (dropped.length > 0) {
      const { error } = await supabase
        .from('exercises')
        .update({ active: false })
        .in('id', dropped)
      if (error) warnings.push(`${day.dayKey}: couldn't hide old exercises`)
    }
    exerciseCount += day.exercises.length

    const catRow = day.category
      ? supabase.from('user_day_categories').upsert(
          { user_id: args.userId, day_key: day.dayKey, category: day.category },
          { onConflict: 'user_id,day_key' },
        )
      : null
    if (catRow) {
      const { error } = await catRow
      if (error) warnings.push(`${day.dayKey}: category not saved`)
    }
  }

  // Plan days are rotation days, not flex days.
  const { error: flexError } = await supabase
    .from('user_flex_days')
    .delete()
    .eq('user_id', args.userId)
    .in('day_key', planKeys)
  if (flexError) warnings.push('flex flags not cleared')

  if (args.hideDays.length > 0) {
    const { error } = await supabase
      .from('exercises')
      .update({ active: false })
      .eq('user_id', args.userId)
      .in('day_type', args.hideDays)
    if (error) return { ok: false, message: `Plan saved but hiding old days failed: ${error.message}` }
  }

  const { error: rotError } = await supabase.from('user_rotation').upsert(
    {
      user_id: args.userId,
      mode: 'manual',
      sequence: args.sequence,
      current_index: args.currentIndex,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )
  if (rotError) warnings.push('workout order not updated')

  for (const [list, enabled] of [
    [args.restWeekdaysDisable, false],
    [args.restWeekdaysEnable, true],
  ] as const) {
    for (const dow of list) {
      const { error } = await supabase.rpc('set_rest_weekday', {
        p_day_of_week: dow,
        p_enabled: enabled,
        p_local_date: args.localDate,
      })
      if (error) {
        warnings.push(
          `${DOW_LABELS[dow]} rest: ${mapCoachRpcError(error.message, error.message)}`,
        )
      }
    }
  }

  const hidden =
    args.hideDays.length > 0 ? ` Hid ${args.hideDays.length} old day${args.hideDays.length === 1 ? '' : 's'}.` : ''
  return {
    ok: true,
    message:
      `Set up ${args.days.length} training days (${exerciseCount} exercises) with rest timers.${hidden}` +
      (warnings.length > 0 ? ` Heads up: ${warnings.join('; ')}.` : ''),
  }
}
