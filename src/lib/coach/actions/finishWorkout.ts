import type { SupabaseClient } from '@supabase/supabase-js'
import { advanceRotationAfterFinish } from '@/lib/utils/rotationStore'
import { hourInTimeZone } from './dates'
import { insertCoachProposal } from './proposals'
import { mapCoachRpcError } from './rpcErrors'
import { COACH_PROPOSAL_INSERT_FAILED } from './types'
import type { CoachActionPayload, CoachProposalView } from './types'

export async function previewFinishWorkout(
  supabase: SupabaseClient,
  args: {
    userId: string
    conversationId: string | null
    note?: string | null
    localDate: string
    timeZone: string | null
  },
): Promise<
  | { ok: true; proposal: CoachProposalView }
  | { ok: false; reason: string }
> {
  const { data: session, error } = await supabase
    .from('sessions')
    .select('id, day_type, started_at')
    .eq('user_id', args.userId)
    .is('completed_at', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    return { ok: false, reason: 'Could not load your open workout.' }
  }
  if (!session) {
    return {
      ok: false,
      reason: 'No open workout to finish. Start a session first.',
    }
  }

  const { count, error: logErr } = await supabase
    .from('session_logs')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', session.id)
    .eq('is_skipped', false)
    .eq('is_warmup', false)
    .not('weight', 'is', null)
    .not('reps', 'is', null)

  if (logErr) {
    return { ok: false, reason: 'Could not check logged sets.' }
  }
  if (!count) {
    return {
      ok: false,
      reason:
        'Log at least one working set (weight and reps, not a warm-up) before finishing.',
    }
  }

  const note = args.note?.trim() ? args.note.trim().slice(0, 500) : null
  const startHour = hourInTimeZone(String(session.started_at), args.timeZone)
  const dayType = String(session.day_type)

  const payload: CoachActionPayload = {
    kind: 'finish_workout',
    card: {
      title: 'Finish workout',
      summaryLines: [
        `Day: ${dayType}`,
        `${count} working set${count === 1 ? '' : 's'} logged`,
        note ? `Note: ${note}` : 'No workout note',
      ],
      riskNote:
        'Marks this session complete (XP/PRs/streak recompute). You can undo from Coach or Home for 10 minutes.',
    },
    execute: {
      sessionId: String(session.id),
      dayType,
      note,
      localDate: args.localDate,
      startHour,
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

export async function executeFinishWorkout(
  supabase: SupabaseClient,
  args: {
    userId: string
    sessionId: string
    dayType: string
    note: string | null
    localDate: string
    startHour: number | null
  },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.rpc('complete_session', {
    p_session_id: args.sessionId,
    p_local_date: args.localDate,
    p_note: args.note,
    p_start_hour: args.startHour,
  })
  if (error) {
    const alreadyDone = (error.message ?? '').includes('SESSION_NOT_OPEN')
    if (!alreadyDone) {
      return {
        ok: false,
        message: mapCoachRpcError(
          error.message,
          error.message || 'Could not finish the workout.',
        ),
      }
    }
  }
  try {
    await advanceRotationAfterFinish(supabase, args.userId, args.dayType, args.sessionId)
  } catch {
    // Same as ActiveWorkout: rotation is best-effort and must not block finish.
  }
  return { ok: true }
}
