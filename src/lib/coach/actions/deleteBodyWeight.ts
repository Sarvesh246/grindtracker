import type { SupabaseClient } from '@supabase/supabase-js'
import { parseCalendarDateKey } from './dates'
import { insertCoachProposal, fmtWeightForUnit } from './proposals'
import { COACH_PROPOSAL_INSERT_FAILED } from './types'
import type { CoachActionPayload, CoachProposalView } from './types'

export async function previewDeleteBodyWeight(
  supabase: SupabaseClient,
  args: {
    userId: string
    conversationId: string | null
    date: string
    unit: 'lb' | 'kg'
  },
): Promise<
  | { ok: true; proposal: CoachProposalView }
  | { ok: false; reason: string }
> {
  const recordedAt = parseCalendarDateKey(args.date)
  if (!recordedAt) {
    return { ok: false, reason: 'Date must be YYYY-MM-DD.' }
  }

  const { data: existing, error } = await supabase
    .from('body_weights')
    .select('weight')
    .eq('user_id', args.userId)
    .eq('recorded_at', recordedAt)
    .maybeSingle()

  if (error) {
    return { ok: false, reason: 'Could not load that body-weight entry.' }
  }
  if (!existing) {
    return {
      ok: false,
      reason: `No body-weight log on ${recordedAt}.`,
    }
  }

  const unitLabel = args.unit === 'kg' ? 'kg' : 'lb'
  const previousWeightLbs = Number(existing.weight)
  const payload: CoachActionPayload = {
    kind: 'delete_body_weight',
    card: {
      title: 'Delete body weight',
      summaryLines: [
        `Date: ${recordedAt}`,
        `Logged: ${fmtWeightForUnit(previousWeightLbs, unitLabel)}`,
      ],
      riskNote: 'Removes this day’s body-weight entry. History on other dates is unchanged.',
    },
    execute: {
      recordedAt,
      previousWeightLbs,
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

export async function executeDeleteBodyWeight(
  supabase: SupabaseClient,
  args: { userId: string; recordedAt: string },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data, error } = await supabase
    .from('body_weights')
    .delete()
    .eq('user_id', args.userId)
    .eq('recorded_at', args.recordedAt)
    .select('recorded_at')
    .maybeSingle()

  if (error) {
    return { ok: false, message: error.message }
  }
  if (!data) {
    return { ok: false, message: 'No body-weight entry found for that date.' }
  }
  return { ok: true }
}
