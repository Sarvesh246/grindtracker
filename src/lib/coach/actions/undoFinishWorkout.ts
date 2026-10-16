import type { SupabaseClient } from '@supabase/supabase-js'
import { loadRotationState, restoreRotationPointer } from '@/lib/utils/rotationStore'
import { insertCoachProposal } from './proposals'
import { mapCoachRpcError } from './rpcErrors'
import { COACH_PROPOSAL_INSERT_FAILED } from './types'
import type { CoachActionPayload, CoachProposalView } from './types'

const UNDO_WINDOW_MS = 10 * 60 * 1000

export async function previewUndoFinishWorkout(
  supabase: SupabaseClient,
  args: {
    userId: string
    conversationId: string | null
    localDate: string
  },
): Promise<
  | { ok: true; proposal: CoachProposalView }
  | { ok: false; reason: string }
> {
  const { data: session, error } = await supabase
    .from('sessions')
    .select('id, day_type, local_date, completed_at')
    .eq('user_id', args.userId)
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    return { ok: false, reason: 'Could not load your last workout.' }
  }
  if (!session?.completed_at) {
    return {
      ok: false,
      reason: 'No finished workout to undo.',
    }
  }

  const completedAt = Date.parse(String(session.completed_at))
  if (!Number.isFinite(completedAt) || Date.now() - completedAt > UNDO_WINDOW_MS) {
    return {
      ok: false,
      reason:
        'The 10-minute undo window has passed. This workout stays finished.',
    }
  }

  const dayType = String(session.day_type)
  const localDate =
    (session.local_date as string | null) ?? args.localDate

  // Same resolver Home uses, so "the slot before this day" is the real one.
  let prevRotationIndex: number | null = null
  try {
    const { seq, index } = await loadRotationState(supabase, args.userId)
    if (seq.length > 0 && index >= 0 && seq[index] === dayType) {
      prevRotationIndex = (index - 1 + seq.length) % seq.length
    }
  } catch { /* leave the pointer alone on undo */ }

  const remainingMin = Math.max(
    1,
    Math.ceil((UNDO_WINDOW_MS - (Date.now() - completedAt)) / 60_000),
  )

  const payload: CoachActionPayload = {
    kind: 'undo_finish_workout',
    card: {
      title: 'Undo finish',
      summaryLines: [
        `Reopen ${dayType}`,
        localDate ? `Finished ${localDate}` : 'Just finished',
        `About ${remainingMin} min left in the undo window`,
      ],
      riskNote:
        'Reopens the workout so you can keep logging. XP/streak are recomputed. The 10-minute window still applies at Confirm.',
    },
    execute: {
      sessionId: String(session.id),
      dayType,
      localDate,
      prevRotationIndex,
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

export async function executeUndoFinishWorkout(
  supabase: SupabaseClient,
  args: {
    userId: string
    sessionId: string
    localDate: string | null
    prevRotationIndex: number | null
  },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.rpc('uncomplete_session', {
    p_session_id: args.sessionId,
    p_local_date: args.localDate,
  })
  if (error) {
    return {
      ok: false,
      message: mapCoachRpcError(
        error.message,
        error.message || 'Could not undo the finish.',
      ),
    }
  }
  if (args.prevRotationIndex != null) {
    try {
      await restoreRotationPointer(supabase, args.userId, { index: args.prevRotationIndex, day: null })
    } catch { /* session is reopened; the pointer is best-effort */ }
  }
  return { ok: true }
}
