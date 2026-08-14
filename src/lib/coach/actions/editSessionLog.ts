import type { SupabaseClient } from '@supabase/supabase-js'
import { LBS_PER_KG } from '@/lib/utils/units'
import { parseCalendarDateKey } from './dates'
import { pickExerciseByName } from './resolveExercise'
import { insertCoachProposal, fmtWeightForUnit } from './proposals'
import { mapCoachRpcError } from './rpcErrors'
import { COACH_PROPOSAL_INSERT_FAILED } from './types'
import type {
  CoachActionPayload,
  CoachProposalView,
  CoachSessionLogRow,
} from './types'

export type SessionLogEditPatch = {
  reps?: number
  weightLbs?: number
  rpe?: number | null
  note?: string | null
  isWarmup?: boolean
}

function hasWorkingSet(logs: CoachSessionLogRow[]): boolean {
  return logs.some(
    l =>
      !l.is_skipped &&
      !l.is_warmup &&
      l.weight != null &&
      l.reps != null,
  )
}

export function validateSessionLogEditPatch(patch: SessionLogEditPatch):
  | { ok: true }
  | { ok: false; reason: string } {
  const keys = Object.keys(patch) as (keyof SessionLogEditPatch)[]
  if (keys.length === 0) {
    return {
      ok: false,
      reason: 'Provide at least one field to change (reps, weight, RPE, note, or warm-up).',
    }
  }
  if (patch.reps !== undefined) {
    const reps = Math.round(Number(patch.reps))
    if (!Number.isFinite(reps) || reps < 0 || reps > 500) {
      return { ok: false, reason: 'Reps must be between 0 and 500.' }
    }
  }
  if (patch.weightLbs !== undefined) {
    const w = Number(patch.weightLbs)
    if (!Number.isFinite(w) || w <= 0) {
      return { ok: false, reason: 'Weight must be a positive number.' }
    }
  }
  if (patch.rpe !== undefined && patch.rpe !== null) {
    const rpe = Math.round(Number(patch.rpe))
    if (!Number.isFinite(rpe) || rpe < 1 || rpe > 10) {
      return { ok: false, reason: 'RPE must be 1–10 (or null to clear).' }
    }
  }
  if (patch.note !== undefined && patch.note !== null) {
    if (typeof patch.note !== 'string') {
      return { ok: false, reason: 'Note must be text.' }
    }
  }
  return { ok: true }
}

/**
 * Apply a single-set field patch onto a full session log array.
 * Does not mutate `logs`. Independently unit-tested — upsert_past_session
 * replaces ALL rows, so a missed copy would silently drop untouched sets.
 */
export function applySessionLogEdit(
  logs: CoachSessionLogRow[],
  target: { exerciseId: string; setNumber: number },
  patch: SessionLogEditPatch,
):
  | { ok: true; logs: CoachSessionLogRow[]; changed: CoachSessionLogRow }
  | { ok: false; reason: string } {
  const checked = validateSessionLogEditPatch(patch)
  if (!checked.ok) return checked

  const idx = logs.findIndex(
    l =>
      l.exercise_id === target.exerciseId &&
      l.set_number === target.setNumber,
  )
  if (idx < 0) {
    return {
      ok: false,
      reason: `No set ${target.setNumber} of that exercise in this session.`,
    }
  }

  const current = logs[idx]!
  const next: CoachSessionLogRow = { ...current }

  if (patch.reps !== undefined) next.reps = Math.round(Number(patch.reps))
  if (patch.weightLbs !== undefined) next.weight = Number(patch.weightLbs)
  if (patch.rpe !== undefined) {
    next.rpe =
      patch.rpe === null ? null : Math.round(Number(patch.rpe))
  }
  if (patch.note !== undefined) {
    const n = patch.note == null ? null : String(patch.note).trim()
    next.note = n ? n.slice(0, 500) : null
  }
  if (patch.isWarmup !== undefined) next.is_warmup = Boolean(patch.isWarmup)

  const supplyingLift =
    patch.weightLbs !== undefined || patch.reps !== undefined
  if (current.is_skipped && supplyingLift) {
    if (next.weight == null || next.reps == null) {
      return {
        ok: false,
        reason: 'Unskipping a set needs both weight and reps.',
      }
    }
    next.is_skipped = false
  }

  if (next.is_skipped) {
    if (patch.isWarmup || patch.weightLbs !== undefined || patch.rpe) {
      return {
        ok: false,
        reason:
          'That set is skipped. Pass weight and reps to turn it back into a logged set, or use skip/unskip on an open workout.',
      }
    }
    next.weight = null
    next.reps = null
    next.is_warmup = false
    next.rpe = null
  }

  const rebuilt = logs.map((l, i) => (i === idx ? next : { ...l }))
  if (!hasWorkingSet(rebuilt)) {
    return {
      ok: false,
      reason:
        'A workout needs at least one working set. This edit would leave none.',
    }
  }

  return { ok: true, logs: rebuilt, changed: next }
}

function rowFromDb(r: {
  exercise_id: string
  set_number: number
  weight: number | null
  reps: number | null
  is_warmup: boolean | null
  is_skipped: boolean | null
  note: string | null
  rpe: number | null
}): CoachSessionLogRow {
  return {
    exercise_id: String(r.exercise_id),
    set_number: Number(r.set_number),
    weight: r.weight == null ? null : Number(r.weight),
    reps: r.reps == null ? null : Number(r.reps),
    is_warmup: Boolean(r.is_warmup),
    is_skipped: Boolean(r.is_skipped),
    note: r.note ?? null,
    rpe: r.rpe == null ? null : Number(r.rpe),
  }
}

export async function previewEditSessionLog(
  supabase: SupabaseClient,
  args: {
    userId: string
    conversationId: string | null
    dayType: string
    localDate: string
    exerciseName: string
    setNumber: number
    patch: SessionLogEditPatch
    unit: 'lb' | 'kg'
  },
): Promise<
  | { ok: true; proposal: CoachProposalView }
  | { ok: false; reason: string }
> {
  const dayType = String(args.dayType ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
  const localDate = parseCalendarDateKey(args.localDate)
  const setNumber = Math.round(Number(args.setNumber))
  if (!dayType) return { ok: false, reason: 'Day name is required.' }
  if (!localDate) return { ok: false, reason: 'Date must be YYYY-MM-DD.' }
  if (!Number.isFinite(setNumber) || setNumber < 1) {
    return { ok: false, reason: 'Set number must be a positive integer.' }
  }

  const { data: session, error: sessErr } = await supabase
    .from('sessions')
    .select('id, day_type, local_date')
    .eq('user_id', args.userId)
    .eq('day_type', dayType)
    .eq('local_date', localDate)
    .not('completed_at', 'is', null)
    .maybeSingle()

  if (sessErr) {
    return { ok: false, reason: 'Could not load that workout.' }
  }
  if (!session) {
    return {
      ok: false,
      reason: `No completed ${dayType} workout on ${localDate}.`,
    }
  }

  const { data: logRows, error: logErr } = await supabase
    .from('session_logs')
    .select(
      'exercise_id, set_number, weight, reps, is_warmup, is_skipped, note, rpe, exercises(name)',
    )
    .eq('session_id', session.id)
    .order('created_at', { ascending: true })

  if (logErr || !logRows) {
    return { ok: false, reason: 'Could not load that session’s sets.' }
  }

  type LogJoin = (typeof logRows)[number] & {
    exercises: { name: string } | { name: string }[] | null
  }
  const named = (logRows as LogJoin[]).map(r => {
    const ex = r.exercises
    let name = 'Unknown'
    if (Array.isArray(ex)) name = ex[0]?.name ?? 'Unknown'
    else if (ex && typeof ex === 'object' && 'name' in ex) {
      name = String((ex as { name: string }).name ?? 'Unknown')
    }
    return { id: String(r.exercise_id), name }
  })
  const uniqueNamed = [
    ...new Map(named.map(e => [e.id, e])).values(),
  ]
  const picked = pickExerciseByName(uniqueNamed, args.exerciseName)
  if (!picked.ok) {
    return {
      ok: false,
      reason: `No exercise matching "${args.exerciseName}" in that session.`,
    }
  }

  const currentLogs = (logRows as LogJoin[]).map(rowFromDb)
  const applied = applySessionLogEdit(
    currentLogs,
    { exerciseId: picked.exercise.id, setNumber },
    args.patch,
  )
  if (!applied.ok) return applied

  const unitLabel = args.unit === 'kg' ? 'kg' : 'lb'
  const before = currentLogs.find(
    l =>
      l.exercise_id === picked.exercise.id && l.set_number === setNumber,
  )!
  const after = applied.changed
  const lines: string[] = [
    `${picked.exercise.name} · set ${setNumber}`,
    `${localDate} · ${dayType}`,
  ]
  if (before.reps !== after.reps) {
    lines.push(`Reps: ${before.reps ?? '—'} → ${after.reps ?? '—'}`)
  }
  if (before.weight !== after.weight) {
    lines.push(
      `Weight: ${
        before.weight != null
          ? fmtWeightForUnit(before.weight, unitLabel)
          : '—'
      } → ${
        after.weight != null ? fmtWeightForUnit(after.weight, unitLabel) : '—'
      }`,
    )
  }
  if (before.rpe !== after.rpe) {
    lines.push(`RPE: ${before.rpe ?? '—'} → ${after.rpe ?? '—'}`)
  }
  if (before.note !== after.note) {
    lines.push(`Note: ${after.note ?? '(cleared)'}`)
  }
  if (before.is_warmup !== after.is_warmup) {
    lines.push(after.is_warmup ? 'Marked as warm-up' : 'Marked as working set')
  }
  if (before.is_skipped !== after.is_skipped) {
    lines.push(after.is_skipped ? 'Left skipped' : 'Converted from skipped to logged')
  }

  const payload: CoachActionPayload = {
    kind: 'edit_session_log',
    card: {
      title: 'Edit logged set',
      summaryLines: lines,
      riskNote:
        'Replaces this session’s full set list (other sets are kept as they are now). For the same wrong weight across many past sessions, use correct past weights instead.',
    },
    execute: {
      sessionId: String(session.id),
      dayType: String(session.day_type),
      localDate,
      exerciseName: picked.exercise.name,
      setNumber,
      logs: applied.logs,
    },
  }

  const proposal = await insertCoachProposal(supabase, {
    userId: args.userId,
    conversationId: args.conversationId,
    payload,
  })
  if (!proposal) {
    return { ok: false, reason: COACH_PROPOSAL_INSERT_FAILED }
  }
  return { ok: true, proposal }
}

export async function executeEditSessionLog(
  supabase: SupabaseClient,
  execute: {
    sessionId: string
    dayType: string
    localDate: string
    logs: CoachSessionLogRow[]
  },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.rpc('upsert_past_session', {
    p_day_type: execute.dayType,
    p_local_date: execute.localDate,
    p_logs: execute.logs,
    p_session_id: execute.sessionId,
    p_note: null,
  })
  if (error) {
    return {
      ok: false,
      message: mapCoachRpcError(
        error.message,
        error.message || 'Could not save the set edit.',
      ),
    }
  }
  return { ok: true }
}

/** Convert a display-unit weight from the model into canonical lbs for the patch. */
export function displayWeightToLbs(
  weight: number,
  unit: 'lb' | 'kg',
): number {
  return unit === 'kg' ? weight * LBS_PER_KG : weight
}
