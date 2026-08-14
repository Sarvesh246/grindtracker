import type { SupabaseClient } from '@supabase/supabase-js'
import { dayOfWeekFromDateKey } from './dates'
import { insertCoachProposal } from './proposals'
import { mapCoachRpcError } from './rpcErrors'
import { COACH_PROPOSAL_INSERT_FAILED } from './types'
import type { CoachActionPayload, CoachProposalView } from './types'

export async function previewToggleRestToday(
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
  const [{ data: oneOff }, { data: weekly }] = await Promise.all([
    supabase
      .from('user_rest_dates')
      .select('rest_date')
      .eq('user_id', args.userId)
      .eq('rest_date', args.localDate)
      .maybeSingle(),
    supabase
      .from('user_rest_days')
      .select('day_of_week, effective_from, effective_until')
      .eq('user_id', args.userId)
      .is('effective_until', null),
  ])

  const turningOn = !oneOff
  if (turningOn) {
    const dow = dayOfWeekFromDateKey(args.localDate)
    const scheduled = (weekly ?? []).some(
      r =>
        Number(r.day_of_week) === dow &&
        String(r.effective_from) <= args.localDate,
    )
    if (scheduled) {
      return {
        ok: false,
        reason:
          'Today is already a scheduled rest day. Change weekly rest days if you want a different schedule.',
      }
    }
  }

  const payload: CoachActionPayload = {
    kind: 'toggle_rest_today',
    card: {
      title: turningOn ? 'Rest today' : 'Undo rest today',
      summaryLines: [
        args.localDate,
        turningOn
          ? 'Mark today as a one-off rest day'
          : 'Remove today’s one-off rest day',
      ],
      riskNote: turningOn
        ? 'Uses one slot from this week’s rest budget (may cancel a later scheduled rest day this week). Does not increment your streak — it only bridges a gap.'
        : 'Clears the one-off. If a later rest day was cancelled to pay for it, that day is restored.',
    },
    execute: {
      localDate: args.localDate,
      turningOn,
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

export async function executeToggleRestToday(
  supabase: SupabaseClient,
  localDate: string,
): Promise<
  | { ok: true; rest: boolean; undone?: boolean; scheduled?: boolean }
  | { ok: false; message: string }
> {
  const { data, error } = await supabase.rpc('toggle_rest_today', {
    p_local_date: localDate,
  })
  if (error) {
    return {
      ok: false,
      message: mapCoachRpcError(
        error.message,
        error.message || 'Could not update rest today.',
      ),
    }
  }
  const result = (data ?? {}) as {
    rest?: boolean
    undone?: boolean
    scheduled?: boolean
  }
  if (result.scheduled) {
    return {
      ok: false,
      message:
        'Today is already a scheduled rest day. Change weekly rest days instead.',
    }
  }
  return {
    ok: true,
    rest: Boolean(result.rest),
    undone: result.undone,
    scheduled: result.scheduled,
  }
}
