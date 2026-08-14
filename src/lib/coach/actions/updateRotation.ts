import type { SupabaseClient } from '@supabase/supabase-js'
import type { UserRotation } from '@/lib/types'
import { autoSequence, effectiveSequence } from '@/lib/utils/rotation'
import { insertCoachProposal } from './proposals'
import { COACH_PROPOSAL_INSERT_FAILED } from './types'
import type { CoachActionPayload, CoachProposalView } from './types'

export function validateUpdateRotationInput(input: {
  mode: 'auto' | 'manual'
  sequence?: string[] | null
  dayKeys: string[]
}):
  | { ok: true; mode: 'auto' | 'manual'; sequence: string[] }
  | { ok: false; reason: string } {
  const mode = input.mode === 'manual' ? 'manual' : 'auto'
  const known = new Set(input.dayKeys)

  if (mode === 'auto') {
    const sequence = Array.isArray(input.sequence)
      ? input.sequence.map(s => String(s).trim().toLowerCase()).filter(Boolean)
      : []
    return { ok: true, mode, sequence }
  }

  if (!Array.isArray(input.sequence) || input.sequence.length === 0) {
    return {
      ok: false,
      reason: 'Manual order needs a sequence of day names (they may repeat).',
    }
  }
  const sequence = input.sequence.map(s =>
    String(s).trim().toLowerCase().replace(/\s+/g, ' '),
  )
  const unknown = [...new Set(sequence.filter(k => !known.has(k)))]
  if (unknown.length > 0) {
    return {
      ok: false,
      reason: `Unknown day${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}. Your days: ${input.dayKeys.join(', ') || '(none)'}.`,
    }
  }
  return { ok: true, mode, sequence }
}

export async function previewUpdateRotation(
  supabase: SupabaseClient,
  args: {
    userId: string
    conversationId: string | null
    mode: 'auto' | 'manual'
    sequence?: string[] | null
  },
): Promise<
  | { ok: true; proposal: CoachProposalView }
  | { ok: false; reason: string }
> {
  const [{ data: exerciseRows }, { data: rotationRow }, { data: flexRows }] =
    await Promise.all([
      supabase.from('exercises').select('day_type').eq('user_id', args.userId),
      supabase
        .from('user_rotation')
        .select('*')
        .eq('user_id', args.userId)
        .maybeSingle(),
      supabase.from('user_flex_days').select('day_key').eq('user_id', args.userId),
    ])

  const dayKeys = [
    ...new Set(
      (exerciseRows ?? [])
        .map(r => String(r.day_type ?? '').trim())
        .filter(Boolean),
    ),
  ].sort()
  const flexSet = new Set(
    (flexRows ?? []).map((r: { day_key: string }) => r.day_key),
  )
  const current = (rotationRow as UserRotation | null) ?? null

  const validated = validateUpdateRotationInput({
    mode: args.mode,
    sequence: args.sequence,
    dayKeys,
  })
  if (!validated.ok) return validated

  const nextRow: UserRotation = {
    user_id: args.userId,
    mode: validated.mode,
    sequence:
      validated.mode === 'manual'
        ? validated.sequence
        : validated.sequence.length > 0
          ? validated.sequence
          : (current?.sequence ?? []),
    current_index: current?.current_index ?? -1,
    updated_at: new Date().toISOString(),
  }
  const resultingOrder =
    validated.mode === 'auto'
      ? autoSequence(dayKeys, flexSet)
      : effectiveSequence(nextRow, dayKeys, flexSet)

  if (resultingOrder.length === 0) {
    return {
      ok: false,
      reason: 'You have no workout days to order yet.',
    }
  }

  const payload: CoachActionPayload = {
    kind: 'update_rotation',
    card: {
      title: 'Update workout order',
      summaryLines: [
        validated.mode === 'auto'
          ? 'Mode: auto (each day once, A–Z, flex days excluded)'
          : 'Mode: manual (saved sequence)',
        `Order: ${resultingOrder.join(' → ')}`,
      ],
      riskNote:
        'This is the full resulting day order, not just the diff. Suggestion is non-binding — you can still start any day from Log. Current “up next” pointer is preserved.',
      steps: resultingOrder.map((d, i) => `${i + 1}. ${d}`),
    },
    execute: {
      mode: nextRow.mode,
      sequence: nextRow.sequence,
      currentIndex: nextRow.current_index,
      resultingOrder,
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

export async function executeUpdateRotation(
  supabase: SupabaseClient,
  args: {
    userId: string
    mode: 'auto' | 'manual'
    sequence: string[]
    currentIndex: number
  },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.from('user_rotation').upsert(
    {
      user_id: args.userId,
      mode: args.mode,
      sequence: args.sequence,
      current_index: args.currentIndex,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )
  if (error) return { ok: false, message: error.message }
  return { ok: true }
}
