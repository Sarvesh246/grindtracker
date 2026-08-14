import type { SupabaseClient } from '@supabase/supabase-js'
import { LBS_PER_KG } from '@/lib/utils/units'
import {
  fmtWeightForUnit,
  insertCoachProposal,
  weightsMatch,
} from './proposals'
import type {
  CoachActionPayload,
  CoachPastLogRow,
  CoachProposalView,
  CorrectWeightsExecutePayload,
} from './types'

type PreviewInput = {
  exerciseName: string
  fromWeight: number
  toWeight: number
  /** Display unit the model/user stated numbers in. */
  unit: 'lb' | 'kg'
}

function toCanonicalLbs(value: number, unit: 'lb' | 'kg'): number {
  if (unit === 'kg') return value * LBS_PER_KG
  return value
}

function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Find completed sessions with matching exercise+weight and build full
 * replacement log payloads for upsert_past_session.
 */
export async function previewCorrectWeights(
  supabase: SupabaseClient,
  args: {
    userId: string
    conversationId: string | null
    input: PreviewInput
  },
): Promise<
  | { ok: true; proposal: CoachProposalView; matchedSets: number }
  | { ok: false; reason: string }
> {
  const fromLbs = toCanonicalLbs(args.input.fromWeight, args.input.unit)
  const toLbs = toCanonicalLbs(args.input.toWeight, args.input.unit)
  if (!Number.isFinite(fromLbs) || !Number.isFinite(toLbs)) {
    return { ok: false, reason: 'Weights must be valid numbers.' }
  }
  if (weightsMatch(fromLbs, toLbs)) {
    return { ok: false, reason: 'From and to weights are the same.' }
  }

  const needle = normalizeName(args.input.exerciseName)
  if (!needle) {
    return { ok: false, reason: 'Exercise name is required.' }
  }

  const { data: exercises, error: exErr } = await supabase
    .from('exercises')
    .select('id, name')
    .eq('user_id', args.userId)

  if (exErr) {
    return { ok: false, reason: 'Could not load your exercises.' }
  }

  const matchedExercises = (exercises ?? []).filter(e => {
    const n = normalizeName(String(e.name ?? ''))
    return n === needle || n.includes(needle) || needle.includes(n)
  })

  if (matchedExercises.length === 0) {
    return {
      ok: false,
      reason: `No exercise matching "${args.input.exerciseName}" in your catalog.`,
    }
  }
  if (matchedExercises.length > 1) {
    // Prefer exact name match when several partials hit.
    const exact = matchedExercises.filter(
      e => normalizeName(String(e.name)) === needle,
    )
    if (exact.length !== 1) {
      return {
        ok: false,
        reason: `Multiple exercises match "${args.input.exerciseName}". Be more specific (${matchedExercises
          .map(e => e.name)
          .slice(0, 4)
          .join(', ')}).`,
      }
    }
    matchedExercises.splice(0, matchedExercises.length, ...exact)
  }

  const exercise = matchedExercises[0]!
  const exerciseId = String(exercise.id)

  const { data: sessions, error: sessErr } = await supabase
    .from('sessions')
    .select('id, day_type, local_date, completed_at')
    .eq('user_id', args.userId)
    .not('completed_at', 'is', null)
    .order('local_date', { ascending: false })
    .limit(120)

  if (sessErr || !sessions?.length) {
    return { ok: false, reason: 'No completed workouts found to correct.' }
  }

  const sessionIds = sessions.map(s => s.id as string)
  const { data: logs, error: logErr } = await supabase
    .from('session_logs')
    .select(
      'session_id, exercise_id, set_number, weight, reps, is_warmup, note, is_skipped',
    )
    .in('session_id', sessionIds)

  if (logErr || !logs) {
    return { ok: false, reason: 'Could not load your set history.' }
  }

  const logsBySession = new Map<string, typeof logs>()
  for (const row of logs) {
    const sid = String(row.session_id)
    const list = logsBySession.get(sid) ?? []
    list.push(row)
    logsBySession.set(sid, list)
  }

  const unitLabel = args.input.unit === 'kg' ? 'kg' : 'lb'
  const executeSessions: CorrectWeightsExecutePayload['sessions'] = []
  let matchedSets = 0

  for (const session of sessions) {
    const sid = String(session.id)
    const rows = logsBySession.get(sid) ?? []
    const hasMatch = rows.some(
      r =>
        String(r.exercise_id) === exerciseId &&
        r.weight != null &&
        !r.is_skipped &&
        weightsMatch(Number(r.weight), fromLbs),
    )
    if (!hasMatch) continue

    const rebuilt: CoachPastLogRow[] = []
    let sessionMatched = 0
    for (const r of rows) {
      if (r.is_skipped) continue
      if (r.weight == null || r.reps == null) continue
      let weight = Number(r.weight)
      if (
        String(r.exercise_id) === exerciseId &&
        weightsMatch(weight, fromLbs)
      ) {
        weight = toLbs
        sessionMatched += 1
      }
      rebuilt.push({
        exercise_id: String(r.exercise_id),
        set_number: Number(r.set_number),
        weight,
        reps: Number(r.reps),
        is_warmup: Boolean(r.is_warmup),
        note: (r.note as string | null) ?? null,
      })
    }

    if (sessionMatched === 0 || rebuilt.length === 0) continue
    matchedSets += sessionMatched
    executeSessions.push({
      sessionId: sid,
      dayType: String(session.day_type),
      localDate: String(session.local_date),
      matchedSets: sessionMatched,
      logs: rebuilt,
    })
  }

  if (executeSessions.length === 0) {
    return {
      ok: false,
      reason: `No completed sets of ${exercise.name} at ${fmtWeightForUnit(fromLbs, unitLabel)} found.`,
    }
  }

  const payload: CoachActionPayload = {
    kind: 'correct_weights',
    card: {
      title: 'Correct past weights',
      summaryLines: [
        `${exercise.name}`,
        `${fmtWeightForUnit(fromLbs, unitLabel)} → ${fmtWeightForUnit(toLbs, unitLabel)}`,
        `${executeSessions.length} session${executeSessions.length === 1 ? '' : 's'} · ${matchedSets} set${matchedSets === 1 ? '' : 's'}`,
      ],
      riskNote:
        'Updates matched set weights in place (keeps skips/RPE) and recomputes XP/PRs.',
      steps: executeSessions.map(
        s => `${s.localDate} · ${s.dayType} · ${s.matchedSets} set${s.matchedSets === 1 ? '' : 's'}`,
      ),
    },
    execute: {
      exerciseName: String(exercise.name),
      exerciseId,
      fromWeightLbs: fromLbs,
      toWeightLbs: toLbs,
      unitLabel,
      sessions: executeSessions,
    },
  }

  const proposal = await insertCoachProposal(supabase, {
    userId: args.userId,
    conversationId: args.conversationId,
    payload,
  })
  if (!proposal) {
    return {
      ok: false,
      reason:
        'Could not save the proposal. Apply docs/sql/36-coach-actions.sql if you have not yet.',
    }
  }

  return { ok: true, proposal, matchedSets }
}

export async function executeCorrectWeights(
  supabase: SupabaseClient,
  execute: CorrectWeightsExecutePayload,
  onStep?: (index: number, total: number, label: string) => void | Promise<void>,
): Promise<{ ok: true; updated: number } | { ok: false; message: string }> {
  if (!execute.exerciseId) {
    return { ok: false, message: 'Missing exercise id for weight correction.' }
  }

  const total = execute.sessions.length
  let updated = 0

  for (let i = 0; i < execute.sessions.length; i++) {
    const session = execute.sessions[i]!
    await onStep?.(
      i,
      total,
      `Updating ${session.localDate} (${session.dayType})…`,
    )

    // In-place weight update (migration 37) — preserves is_skipped markers and RPE.
    // Prefer this over upsert_past_session for Coach corrections (full replace).
    // Past-edit path (migration 41) now round-trips skips + RPE when the client sends them.
    const { error } = await supabase.rpc('coach_correct_session_weights', {
      p_session_id: session.sessionId,
      p_exercise_id: execute.exerciseId,
      p_from_weight_lbs: execute.fromWeightLbs,
      p_to_weight_lbs: execute.toWeightLbs,
    })

    if (error) {
      const partial =
        updated > 0
          ? ` Updated ${updated} session${updated === 1 ? '' : 's'} before failing.`
          : ''
      return {
        ok: false,
        message: `Failed on ${session.localDate}: ${error.message}.${partial} Apply docs/sql/37-coach-correct-weights.sql if this RPC is missing.`,
      }
    }
    updated += 1
  }

  return { ok: true, updated }
}
