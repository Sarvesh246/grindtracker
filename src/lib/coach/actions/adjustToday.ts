import type { SupabaseClient } from '@supabase/supabase-js'
import { loadRotationState } from '@/lib/utils/rotationStore'
import { logDayHref, resolveDayKey } from '@/lib/utils/dayKeys'
import { LBS_PER_KG } from '@/lib/utils/units'
import { insertCoachProposal, fmtWeightForUnit } from './proposals'
import { executeStartWorkout } from './startWorkout'
import type {
  AdjustTodayExecutePayload,
  AdjustTodayMode,
  CoachActionCardModel,
  CoachActionPayload,
  CoachProposalView,
} from './types'

/**
 * "A lighter version of today" — trims TODAY's session only, never the saved
 * plan (`exercises` is never written).
 *
 * The seam: skip markers. ActiveWorkout already restores `is_skipped` rows on
 * an open session as skipped sets (the same rows propose_skip_sets writes), so
 * "drop the last set of each lift" is one skip marker per lift on today's open
 * session — started on Confirm when none is open yet. Inserted with
 * ignoreDuplicates, so a set logged in the meantime is never overwritten.
 *
 * scale_weights writes today's lighter numbers to the open session's
 * weight_overrides (migration 60) through set_session_weight_overrides.
 * ActiveWorkout prefills unlogged sets from that map before weight_target /
 * last weight, so the plan (exercises.weight_target) is never touched and no
 * set is logged for the user. The overrides end with the session.
 */

export const ADJUST_TODAY_MIN_PERCENT = 5
export const ADJUST_TODAY_MAX_PERCENT = 30
const MAX_CARD_LIFTS = 6

export type AdjustTodayExercise = {
  id: string
  name: string
  sets_target: number
  weight_target: number | null
}

export type AdjustTodayPlan =
  | {
      ok: true
      drops: AdjustTodayExecutePayload['drops']
      weights: AdjustTodayExecutePayload['weights']
      /** Per-lift card lines. */
      lines: string[]
    }
  | { ok: false; reason: string }

export function validateAdjustTodayInput(input: {
  mode: unknown
  percent?: unknown
}): { ok: true; mode: AdjustTodayMode; percent: number | null } | { ok: false; reason: string } {
  const mode = input.mode === 'scale_weights' ? 'scale_weights' : input.mode === 'drop_last_set' ? 'drop_last_set' : null
  if (!mode) return { ok: false, reason: 'Pick how to lighten today: drop the last set of each lift, or take a percent off the weights.' }
  if (mode === 'drop_last_set') return { ok: true, mode, percent: null }
  const percent = Math.round(Number(input.percent))
  if (!Number.isFinite(percent) || percent < ADJUST_TODAY_MIN_PERCENT || percent > ADJUST_TODAY_MAX_PERCENT) {
    return {
      ok: false,
      reason: `How much lighter? Give a percent between ${ADJUST_TODAY_MIN_PERCENT} and ${ADJUST_TODAY_MAX_PERCENT}.`,
    }
  }
  return { ok: true, mode, percent }
}

/** Round a lighter load to a loadable plate step, always at least one step below `fromLbs`. */
export function lighterWeightLbs(fromLbs: number, percent: number, unit: 'lb' | 'kg'): number {
  if (unit === 'kg') {
    const fromKg = fromLbs / LBS_PER_KG
    const step = fromKg >= 20 ? 2.5 : 1
    let kg = Math.round((fromKg * (1 - percent / 100)) / step) * step
    if (kg >= fromKg) kg = Math.floor(fromKg / step) * step - step
    return Math.max(0, kg) * LBS_PER_KG
  }
  const step = fromLbs >= 50 ? 5 : 2.5
  let lb = Math.round((fromLbs * (1 - percent / 100)) / step) * step
  if (lb >= fromLbs) lb = Math.floor(fromLbs / step) * step - step
  return Math.max(0, lb)
}

/** Pure: what Confirm would change, from rows already read. */
export function planAdjustToday(args: {
  mode: AdjustTodayMode
  percent: number | null
  exercises: AdjustTodayExercise[]
  /** exercise id → set numbers already on the open session (logged or skipped). */
  takenSets: Map<string, Set<number>>
  /** exercise id → last-session working weight (lbs), used when there is no target. */
  lastWeights: Record<string, number | null>
  unit: 'lb' | 'kg'
}): AdjustTodayPlan {
  if (args.exercises.length === 0) {
    return { ok: false, reason: 'That day has no active exercises to lighten.' }
  }

  if (args.mode === 'drop_last_set') {
    const drops: AdjustTodayExecutePayload['drops'] = []
    const lines: string[] = []
    for (const ex of args.exercises) {
      const sets = Math.round(Number(ex.sets_target) || 0)
      if (sets < 2) continue
      // A last set that is already logged or skipped is left alone.
      if (args.takenSets.get(ex.id)?.has(sets)) continue
      drops.push({ exerciseId: ex.id, exerciseName: ex.name, setNumber: sets })
      lines.push(`${ex.name}: ${sets} → ${sets - 1} sets`)
    }
    if (drops.length === 0) {
      return { ok: false, reason: 'Nothing to trim: every lift is already at one set, or its last set is done.' }
    }
    return { ok: true, drops, weights: [], lines }
  }

  const percent = args.percent ?? 0
  const weights: AdjustTodayExecutePayload['weights'] = []
  const lines: string[] = []
  for (const ex of args.exercises) {
    const from = ex.weight_target ?? args.lastWeights[ex.id] ?? null
    if (from == null || !(from > 0)) continue
    const to = lighterWeightLbs(from, percent, args.unit)
    if (!(to > 0)) continue
    weights.push({ exerciseId: ex.id, exerciseName: ex.name, fromLbs: from, toLbs: to })
    lines.push(`${ex.name}: ${fmtWeightForUnit(from, args.unit)} → ${fmtWeightForUnit(to, args.unit)}`)
  }
  if (weights.length === 0) {
    return { ok: false, reason: 'No working weights to scale on that day (bodyweight lifts only, or nothing logged yet).' }
  }
  return { ok: true, drops: [], weights, lines }
}

export function adjustTodayCard(execute: AdjustTodayExecutePayload, lines: string[]): CoachActionCardModel {
  const shown = lines.slice(0, MAX_CARD_LIFTS)
  const more = lines.length - shown.length
  const tail = more > 0 ? [`+${more} more`] : []
  if (execute.mode === 'drop_last_set') {
    return {
      title: 'Lighter today',
      summaryLines: [`${execute.dayType} · today only`, 'Drop the last set of each lift', ...shown, ...tail],
      riskNote: execute.startsSession
        ? 'Starts this workout now with those sets already skipped (markers, not failures). Your saved plan stays as it is.'
        : 'Skips those sets in your open workout (markers, not failures). Your saved plan stays as it is.',
    }
  }
  return {
    title: 'Lighter weights today',
    summaryLines: [`${execute.dayType} · ${execute.percent}% off working weights`, ...shown, ...tail],
    riskNote: execute.startsSession
      ? 'Starts this workout now with these weights prefilled. Your saved targets stay as they are.'
      : 'Prefills these weights for the sets you have left today. Your saved targets stay as they are.',
  }
}

async function activeDayKeys(supabase: SupabaseClient, userId: string): Promise<string[] | null> {
  const { data, error } = await supabase
    .from('exercises')
    .select('day_type')
    .eq('user_id', userId)
    .eq('active', true)
  if (error) return null
  return [...new Set((data ?? []).map(r => String(r.day_type ?? '').trim()).filter(Boolean))]
}

export async function previewAdjustToday(
  supabase: SupabaseClient,
  args: {
    userId: string
    conversationId: string | null
    mode: unknown
    percent?: unknown
    dayType?: string | null
    unit: 'lb' | 'kg'
  },
): Promise<{ ok: true; proposal: CoachProposalView } | { ok: false; reason: string }> {
  const validated = validateAdjustTodayInput(args)
  if (!validated.ok) return validated

  const dayKeys = await activeDayKeys(supabase, args.userId)
  if (!dayKeys) return { ok: false, reason: 'Could not load your workout days.' }
  if (dayKeys.length === 0) return { ok: false, reason: 'You have no active workout days yet.' }

  const { data: openRows, error: openErr } = await supabase
    .from('sessions')
    .select('id, day_type')
    .eq('user_id', args.userId)
    .is('completed_at', null)
    .order('started_at', { ascending: false })
  if (openErr) return { ok: false, reason: 'Could not load your open workout.' }
  const open = (openRows ?? []) as { id: string; day_type: string }[]

  let dayType: string | null = null
  if (args.dayType?.trim()) {
    dayType = resolveDayKey(args.dayType, dayKeys)
    if (!dayType) return { ok: false, reason: `No day named "${args.dayType}". Your days: ${dayKeys.join(', ')}.` }
  } else if (open[0]) {
    dayType = open[0].day_type
  } else {
    const next = await loadRotationState(supabase, args.userId)
      .then(s => s.nextDay)
      .catch(() => null)
    dayType = next && dayKeys.includes(next) ? next : null
    if (!dayType) return { ok: false, reason: 'Which day are you training today?' }
  }
  const session = open.find(s => s.day_type === dayType) ?? null

  const { data: exRows, error: exErr } = await supabase
    .from('exercises')
    .select('id, name, sets_target, weight_target')
    .eq('user_id', args.userId)
    .eq('day_type', dayType)
    .eq('active', true)
    .order('sort_order', { ascending: true })
  if (exErr) return { ok: false, reason: 'Could not load that day’s exercises.' }
  const exercises = (exRows ?? []) as AdjustTodayExercise[]

  const takenSets = new Map<string, Set<number>>()
  if (session) {
    const { data: logRows, error: logErr } = await supabase
      .from('session_logs')
      .select('exercise_id, set_number')
      .eq('session_id', session.id)
    if (logErr) return { ok: false, reason: 'Could not load the sets you have logged today.' }
    for (const r of (logRows ?? []) as { exercise_id: string; set_number: number }[]) {
      const set = takenSets.get(r.exercise_id) ?? new Set<number>()
      set.add(Number(r.set_number))
      takenSets.set(r.exercise_id, set)
    }
  }

  const lastWeights: Record<string, number | null> = {}
  if (validated.mode === 'scale_weights' && exercises.length > 0) {
    const { data: lastRows } = await supabase.rpc('get_exercise_last_weights', {
      p_exercise_ids: exercises.map(e => e.id),
    })
    for (const r of (lastRows ?? []) as { exercise_id: string; last_weight: number | string | null }[]) {
      const n = Number(r.last_weight)
      lastWeights[r.exercise_id] = Number.isFinite(n) && n > 0 ? n : null
    }
  }

  const plan = planAdjustToday({
    mode: validated.mode,
    percent: validated.percent,
    exercises,
    takenSets,
    lastWeights,
    unit: args.unit,
  })
  if (!plan.ok) return plan

  const execute: AdjustTodayExecutePayload = {
    mode: validated.mode,
    dayType,
    startsSession: !session,
    drops: plan.drops,
    percent: validated.percent,
    weights: plan.weights,
    unitLabel: args.unit,
  }
  const payload: CoachActionPayload = { kind: 'adjust_today', card: adjustTodayCard(execute, plan.lines), execute }

  const proposal = await insertCoachProposal(supabase, {
    userId: args.userId,
    conversationId: args.conversationId,
    payload,
  })
  if (!proposal) {
    return {
      ok: false,
      reason:
        "Could not save the proposal: the database doesn't accept the adjust_today card kind yet (it needs a migration that adds it to coach_action_proposals). Tell the user the lighter numbers in words instead.",
    }
  }
  return { ok: true, proposal }
}

export async function executeAdjustToday(
  supabase: SupabaseClient,
  args: { userId: string; execute: AdjustTodayExecutePayload },
): Promise<{ ok: true; count: number; href?: string } | { ok: false; message: string }> {
  const { execute } = args
  if (execute.mode === 'scale_weights') {
    const overrides: Record<string, number> = {}
    for (const w of execute.weights) if (w.exerciseId && w.toLbs > 0) overrides[w.exerciseId] = w.toLbs
    if (Object.keys(overrides).length === 0) {
      return { ok: false, message: 'This card is from an older version. Ask the Coach for lighter weights again.' }
    }
  } else if (execute.drops.length === 0) {
    return { ok: false, message: 'No sets to trim.' }
  }

  const findOpen = () =>
    supabase
      .from('sessions')
      .select('id')
      .eq('user_id', args.userId)
      .eq('day_type', execute.dayType)
      .is('completed_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()

  let { data: open } = await findOpen()
  if (!open) {
    if (!execute.startsSession) {
      return { ok: false, message: 'That workout is no longer open, so there is nothing to change.' }
    }
    const started = await executeStartWorkout(supabase, execute.dayType)
    if (!started.ok) return { ok: false, message: started.message }
    ;({ data: open } = await findOpen())
    if (!open) return { ok: false, message: 'Could not open today’s workout.' }
  }

  const sessionId = String(open.id)

  if (execute.mode === 'scale_weights') {
    const overrides: Record<string, number> = {}
    for (const w of execute.weights) if (w.exerciseId && w.toLbs > 0) overrides[w.exerciseId] = w.toLbs
    const { error } = await supabase.rpc('set_session_weight_overrides', {
      p_session_id: sessionId,
      p_overrides: overrides,
    })
    if (error) {
      return {
        ok: false,
        message: /set_session_weight_overrides|function/i.test(error.message)
          ? 'GRIND needs a database update (migration 60) before it can change today’s weights.'
          : error.message,
      }
    }
    return { ok: true, count: Object.keys(overrides).length, href: logDayHref(execute.dayType) }
  }

  // ignoreDuplicates: a set logged (or skipped) since the preview stays as it is.
  const { error } = await supabase.from('session_logs').upsert(
    execute.drops.map(d => ({
      session_id: sessionId,
      exercise_id: d.exerciseId,
      set_number: d.setNumber,
      weight: null,
      reps: null,
      is_pr: false,
      is_warmup: false,
      is_skipped: true,
      rpe: null,
    })),
    { onConflict: 'session_id,exercise_id,set_number', ignoreDuplicates: true },
  )
  if (error) return { ok: false, message: error.message }

  return { ok: true, count: execute.drops.length, href: logDayHref(execute.dayType) }
}

export function formatAdjustTodayMessage(execute: AdjustTodayExecutePayload, count: number): string {
  if (execute.mode === 'scale_weights') {
    const list = execute.weights
      .slice(0, MAX_CARD_LIFTS)
      .map(w => `${w.exerciseName} ${fmtWeightForUnit(w.toLbs, execute.unitLabel)}`)
      .join(', ')
    return `Prefilled today's lighter weights: ${list}. Your plan is unchanged.`
  }
  return `Trimmed ${count} set${count === 1 ? '' : 's'} from today's ${execute.dayType}. Your plan is unchanged.`
}
