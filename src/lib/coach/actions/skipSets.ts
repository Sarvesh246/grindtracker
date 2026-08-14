import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveExerciseByName } from './resolveExercise'
import { insertCoachProposal } from './proposals'
import { COACH_PROPOSAL_INSERT_FAILED } from './types'
import type { CoachActionPayload, CoachProposalView } from './types'

export function validateSkipSetsInput(input: {
  exerciseName: string
  scope: 'sets' | 'exercise'
  setNumbers?: number[] | null
  skip: boolean
}):
  | {
      ok: true
      exerciseName: string
      scope: 'sets' | 'exercise'
      setNumbers: number[]
      skip: boolean
    }
  | { ok: false; reason: string } {
  const exerciseName = String(input.exerciseName ?? '').trim()
  if (!exerciseName) {
    return { ok: false, reason: 'Exercise name is required.' }
  }
  const scope = input.scope === 'exercise' ? 'exercise' : 'sets'
  const skip = Boolean(input.skip)
  let setNumbers: number[] = []
  if (scope === 'sets') {
    const raw = Array.isArray(input.setNumbers) ? input.setNumbers : []
    setNumbers = [
      ...new Set(
        raw
          .map(n => Math.round(Number(n)))
          .filter(n => Number.isFinite(n) && n >= 1 && n <= 30),
      ),
    ].sort((a, b) => a - b)
    if (setNumbers.length === 0) {
      return {
        ok: false,
        reason: 'Pick at least one set number to skip or unskip (1–30).',
      }
    }
  }
  return { ok: true, exerciseName, scope, setNumbers, skip }
}

export async function previewSkipSets(
  supabase: SupabaseClient,
  args: {
    userId: string
    conversationId: string | null
    exerciseName: string
    scope: 'sets' | 'exercise'
    setNumbers?: number[] | null
    skip: boolean
  },
): Promise<
  | { ok: true; proposal: CoachProposalView }
  | { ok: false; reason: string }
> {
  const validated = validateSkipSetsInput(args)
  if (!validated.ok) return validated

  const { data: session, error: sessErr } = await supabase
    .from('sessions')
    .select('id, day_type')
    .eq('user_id', args.userId)
    .is('completed_at', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (sessErr) {
    return { ok: false, reason: 'Could not load your open workout.' }
  }
  if (!session) {
    return {
      ok: false,
      reason: 'No open workout. Skip only works during an active session.',
    }
  }

  let resolved = await resolveExerciseByName(
    supabase,
    args.userId,
    validated.exerciseName,
    { dayType: String(session.day_type) },
  )
  if (!resolved.ok) {
    resolved = await resolveExerciseByName(
      supabase,
      args.userId,
      validated.exerciseName,
    )
  }
  if (!resolved.ok) return resolved
  const ex = resolved.exercise

  const { data: logRows, error: logErr } = await supabase
    .from('session_logs')
    .select('set_number, is_skipped')
    .eq('session_id', session.id)
    .eq('exercise_id', ex.id)

  if (logErr) {
    return { ok: false, reason: 'Could not load this exercise’s sets.' }
  }

  let setNumbers = validated.setNumbers
  if (validated.scope === 'exercise') {
    const loggedNums = (logRows ?? []).map(r => Number(r.set_number))
    const maxLogged = loggedNums.length ? Math.max(...loggedNums) : 0
    const total = Math.max(Number(ex.sets_target) || 0, maxLogged)
    if (validated.skip) {
      const skipped = new Set(
        (logRows ?? [])
          .filter(r => r.is_skipped)
          .map(r => Number(r.set_number)),
      )
      setNumbers = []
      for (let s = 1; s <= total; s++) {
        if (!skipped.has(s)) setNumbers.push(s)
      }
    } else {
      setNumbers = (logRows ?? [])
        .filter(r => r.is_skipped)
        .map(r => Number(r.set_number))
        .sort((a, b) => a - b)
    }
    if (setNumbers.length === 0) {
      return {
        ok: false,
        reason: validated.skip
          ? `${ex.name} is already fully skipped.`
          : `${ex.name} has no skipped sets to restore.`,
      }
    }
  }

  const verb = validated.skip ? 'Skip' : 'Unskip'
  const payload: CoachActionPayload = {
    kind: 'skip_sets',
    card: {
      title: `${verb} ${validated.scope === 'exercise' ? 'exercise' : 'sets'}`,
      summaryLines: [
        ex.name,
        validated.scope === 'exercise'
          ? `${verb} entire exercise`
          : `${verb} set${setNumbers.length === 1 ? '' : 's'} ${setNumbers.join(', ')}`,
        `Open session: ${session.day_type}`,
      ],
      riskNote: validated.skip
        ? 'Skipped sets stay in the workout as markers (not failures) and do not count toward XP or PRs. Already-logged values on those sets are cleared.'
        : 'Removes skip markers so those sets are blank again — re-log weight/reps if you still did them.',
    },
    execute: {
      sessionId: String(session.id),
      exerciseId: ex.id,
      exerciseName: ex.name,
      setNumbers,
      skip: validated.skip,
      scope: validated.scope,
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

export async function executeSkipSets(
  supabase: SupabaseClient,
  execute: {
    sessionId: string
    exerciseId: string
    setNumbers: number[]
    skip: boolean
  },
): Promise<{ ok: true; count: number } | { ok: false; message: string }> {
  if (execute.setNumbers.length === 0) {
    return { ok: false, message: 'No sets to update.' }
  }

  const { data: open } = await supabase
    .from('sessions')
    .select('id')
    .eq('id', execute.sessionId)
    .is('completed_at', null)
    .maybeSingle()
  if (!open) {
    return {
      ok: false,
      message: 'That workout is no longer open. Skip only works on the active session.',
    }
  }

  if (execute.skip) {
    const { error } = await supabase.from('session_logs').upsert(
      execute.setNumbers.map(s => ({
        session_id: execute.sessionId,
        exercise_id: execute.exerciseId,
        set_number: s,
        weight: null,
        reps: null,
        is_pr: false,
        is_warmup: false,
        is_skipped: true,
        rpe: null,
      })),
      { onConflict: 'session_id,exercise_id,set_number' },
    )
    if (error) return { ok: false, message: error.message }
  } else {
    const { error } = await supabase
      .from('session_logs')
      .delete()
      .eq('session_id', execute.sessionId)
      .eq('exercise_id', execute.exerciseId)
      .eq('is_skipped', true)
      .in('set_number', execute.setNumbers)
    if (error) return { ok: false, message: error.message }
  }

  return { ok: true, count: execute.setNumbers.length }
}
