import type { SupabaseClient } from '@supabase/supabase-js'
import { dayOfWeekFromDateKey, DOW_LABELS, parseDayOfWeek } from './dates'
import { insertCoachProposal } from './proposals'
import { mapCoachRpcError } from './rpcErrors'
import { COACH_PROPOSAL_INSERT_FAILED } from './types'
import type { CoachActionPayload, CoachProposalView } from './types'

export function validateSetRestWeekdayInput(input: {
  dayOfWeek: string | number
  enabled: boolean
  localDate: string
}):
  | {
      ok: true
      dayOfWeek: number
      enabled: boolean
      isTodayWeekday: boolean
    }
  | { ok: false; reason: string } {
  const dayOfWeek = parseDayOfWeek(input.dayOfWeek)
  if (dayOfWeek == null) {
    return {
      ok: false,
      reason: 'Day of week must be Sunday–Saturday (or 0–6).',
    }
  }
  const todayDow = dayOfWeekFromDateKey(input.localDate)
  return {
    ok: true,
    dayOfWeek,
    enabled: Boolean(input.enabled),
    isTodayWeekday: todayDow === dayOfWeek,
  }
}

export async function previewSetRestWeekday(
  supabase: SupabaseClient,
  args: {
    userId: string
    conversationId: string | null
    dayOfWeek: string | number
    enabled: boolean
    localDate: string
  },
): Promise<
  | { ok: true; proposal: CoachProposalView }
  | { ok: false; reason: string }
> {
  const validated = validateSetRestWeekdayInput(args)
  if (!validated.ok) return validated

  const label = DOW_LABELS[validated.dayOfWeek]!
  const riskNote =
    validated.enabled && validated.isTodayWeekday
      ? `Newly enabled rest weekdays start on the next ${label} — they do not cover today (that would save a missed workout after the fact). Use Rest today for a one-off.`
      : validated.enabled
        ? `Adds ${label} to the weekly rest schedule from the next occurrence onward.`
        : `Stops counting future ${label}s as rest. Past ${label}s already covered stay in streak history.`

  const payload: CoachActionPayload = {
    kind: 'set_rest_weekday',
    card: {
      title: validated.enabled ? `Rest every ${label}` : `Remove ${label} rest`,
      summaryLines: [
        `${label} (${validated.dayOfWeek})`,
        validated.enabled ? 'Enable weekly rest day' : 'Disable weekly rest day',
      ],
      riskNote,
    },
    execute: {
      dayOfWeek: validated.dayOfWeek,
      enabled: validated.enabled,
      localDate: args.localDate,
      isTodayWeekday: validated.isTodayWeekday,
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

export async function executeSetRestWeekday(
  supabase: SupabaseClient,
  args: { dayOfWeek: number; enabled: boolean; localDate: string },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.rpc('set_rest_weekday', {
    p_day_of_week: args.dayOfWeek,
    p_enabled: args.enabled,
    p_local_date: args.localDate,
  })
  if (error) {
    return {
      ok: false,
      message: mapCoachRpcError(
        error.message,
        error.message || 'Could not update weekly rest days.',
      ),
    }
  }
  return { ok: true }
}
