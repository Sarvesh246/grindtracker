import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveDayKey } from '@/lib/utils/dayKeys'
import { insertCoachProposal } from './proposals'
import { COACH_PROPOSAL_INSERT_FAILED } from './types'
import type { CoachActionPayload, CoachProposalView } from './types'

type DayRow = { day_type: string; active: boolean | null }

/**
 * A day is "disabled" when it has exercises and every one is inactive (see the
 * Disabled days section of CLAUDE.md) — there is no flag on the day itself, so
 * hiding or showing a whole day flips every exercise in it.
 */
export function planSetDayEnabled(
  rows: ReadonlyArray<DayRow>,
  rawDay: string,
  enabled: boolean,
):
  | { ok: true; dayType: string; total: number; active: number }
  | { ok: false; reason: string } {
  const dayKeys = [...new Set(rows.map(r => String(r.day_type)))].sort()
  const dayType = resolveDayKey(String(rawDay ?? ''), dayKeys)
  if (!dayType) {
    return {
      ok: false,
      reason: `No single day matches "${String(rawDay ?? '').trim()}". Your days: ${dayKeys.join(', ') || '(none)'}.`,
    }
  }
  const mine = rows.filter(r => r.day_type === dayType)
  const total = mine.length
  const active = mine.filter(r => r.active !== false).length
  if (total === 0) {
    return { ok: false, reason: `"${dayType}" has no exercises to ${enabled ? 'show' : 'hide'}.` }
  }
  if (!enabled && active === 0) {
    return { ok: false, reason: `"${dayType}" is already hidden.` }
  }
  if (enabled && active === total) {
    return { ok: false, reason: `"${dayType}" is already showing.` }
  }
  return { ok: true, dayType, total, active }
}

export async function previewSetDayEnabled(
  supabase: SupabaseClient,
  args: {
    userId: string
    conversationId: string | null
    dayType: string
    enabled: boolean
  },
): Promise<
  | { ok: true; proposal: CoachProposalView }
  | { ok: false; reason: string }
> {
  const { data, error } = await supabase
    .from('exercises')
    .select('day_type, active')
    .eq('user_id', args.userId)
  if (error) return { ok: false, reason: 'Could not read your workout days.' }

  const plan = planSetDayEnabled((data ?? []) as DayRow[], args.dayType, args.enabled)
  if (!plan.ok) return plan

  const payload: CoachActionPayload = {
    kind: 'set_day_enabled',
    card: {
      title: args.enabled ? 'Show workout day' : 'Hide workout day',
      summaryLines: [
        `Day: ${plan.dayType}`,
        `${plan.total} exercise${plan.total === 1 ? '' : 's'} ${args.enabled ? 'turned on' : 'turned off'}`,
      ],
      riskNote: args.enabled
        ? 'The day returns to your Log, Home and workout order.'
        : 'Nothing is deleted — exercises, colors and history stay. The day leaves your Log, Home and workout order until you turn it back on in Log → Manage.',
    },
    execute: {
      dayType: plan.dayType,
      enabled: args.enabled,
      exerciseCount: plan.total,
    },
  }

  const proposal = await insertCoachProposal(supabase, {
    userId: args.userId,
    conversationId: args.conversationId,
    payload,
  })
  if (!proposal) return { ok: false, reason: COACH_PROPOSAL_INSERT_FAILED }
  return { ok: true, proposal }
}

export async function executeSetDayEnabled(
  supabase: SupabaseClient,
  args: { userId: string; dayType: string; enabled: boolean },
): Promise<{ ok: true; count: number } | { ok: false; message: string }> {
  const { data, error } = await supabase
    .from('exercises')
    .update({ active: args.enabled })
    .eq('user_id', args.userId)
    .eq('day_type', args.dayType)
    .select('id')
  if (error) return { ok: false, message: error.message }
  const count = data?.length ?? 0
  if (count === 0) return { ok: false, message: 'Day not found.' }
  return { ok: true, count }
}
