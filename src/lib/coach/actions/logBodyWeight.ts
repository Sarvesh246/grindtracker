import type { SupabaseClient } from '@supabase/supabase-js'
import { LBS_PER_KG } from '@/lib/utils/units'
import { parseCalendarDateKey } from './dates'
import { insertCoachProposal, fmtWeightForUnit } from './proposals'
import { COACH_PROPOSAL_INSERT_FAILED } from './types'
import type { CoachActionPayload, CoachProposalView } from './types'

const MAX_WEIGHT_LBS = 2000

export function validateLogBodyWeightInput(input: {
  weight: number
  unit: 'lb' | 'kg'
  date?: string | null
  today: string
}):
  | { ok: true; weightLbs: number; recordedAt: string; unitLabel: 'lb' | 'kg' }
  | { ok: false; reason: string } {
  const unitLabel = input.unit === 'kg' ? 'kg' : 'lb'
  const raw = Number(input.weight)
  if (!Number.isFinite(raw) || raw <= 0) {
    return { ok: false, reason: 'Weight must be a positive number.' }
  }
  const weightLbs = unitLabel === 'kg' ? raw * LBS_PER_KG : raw
  if (weightLbs > MAX_WEIGHT_LBS) {
    return { ok: false, reason: 'Weight is out of range.' }
  }

  let recordedAt = input.today
  if (input.date) {
    const parsed = parseCalendarDateKey(input.date)
    if (!parsed) {
      return { ok: false, reason: 'Date must be YYYY-MM-DD.' }
    }
    if (parsed > input.today) {
      return { ok: false, reason: 'Cannot log a body weight in the future.' }
    }
    recordedAt = parsed
  }
  return { ok: true, weightLbs, recordedAt, unitLabel }
}

export async function previewLogBodyWeight(
  supabase: SupabaseClient,
  args: {
    userId: string
    conversationId: string | null
    weight: number
    unit: 'lb' | 'kg'
    date?: string | null
    today: string
  },
): Promise<
  | { ok: true; proposal: CoachProposalView }
  | { ok: false; reason: string }
> {
  const validated = validateLogBodyWeightInput(args)
  if (!validated.ok) return validated

  const { data: existing } = await supabase
    .from('body_weights')
    .select('weight')
    .eq('user_id', args.userId)
    .eq('recorded_at', validated.recordedAt)
    .maybeSingle()

  const overwritten = existing != null
  const payload: CoachActionPayload = {
    kind: 'log_body_weight',
    card: {
      title: overwritten ? 'Update body weight' : 'Log body weight',
      summaryLines: [
        `${fmtWeightForUnit(validated.weightLbs, validated.unitLabel)}`,
        `Date: ${validated.recordedAt}`,
        overwritten
          ? `Replaces ${fmtWeightForUnit(Number(existing.weight), validated.unitLabel)} already logged that day`
          : 'New entry for that day',
      ],
      riskNote: overwritten
        ? 'Overwrites any existing body-weight entry for this date.'
        : null,
    },
    execute: {
      weightLbs: validated.weightLbs,
      recordedAt: validated.recordedAt,
      unitLabel: validated.unitLabel,
      overwritten,
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

export async function executeLogBodyWeight(
  supabase: SupabaseClient,
  args: { userId: string; weightLbs: number; recordedAt: string },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.from('body_weights').upsert(
    {
      user_id: args.userId,
      weight: args.weightLbs,
      recorded_at: args.recordedAt,
    },
    { onConflict: 'user_id,recorded_at' },
  )
  if (error) {
    return { ok: false, message: error.message }
  }
  return { ok: true }
}
