import type { SupabaseClient } from '@supabase/supabase-js'
import { enabledDayKeys, resolveDayKey } from '@/lib/utils/dayKeys'
import { writeRotationRow } from '@/lib/utils/rotationStore'
import type { UserRotation } from '@/lib/types'
import { autoSequence, dayAtIndex, effectiveSequence, resolveRotationIndex } from '@/lib/utils/rotation'
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
  // Each entry may name one day ("Push Day", "push") or several that happen
  // together ("push + abs", "legs and abs"). A rotation slot holds one day, so
  // a pair becomes two back-to-back slots, in the order given.
  const sequence: string[] = []
  const unknown: string[] = []
  for (const entry of input.sequence) {
    const raw = String(entry).trim()
    const whole = resolveDayKey(raw, input.dayKeys)
    const parts = whole
      ? [whole]
      : raw.split(/\s*(?:\+|&|\/|,|\band\b|\bwith\b|\balongside\b)\s*/i).filter(Boolean)
    for (const part of parts) {
      const key = resolveDayKey(part, input.dayKeys)
      if (key && known.has(key)) sequence.push(key)
      else unknown.push(part)
    }
  }
  if (unknown.length > 0) {
    const missing = [...new Set(unknown)]
    return {
      ok: false,
      reason: `No day matches ${missing.map(m => `"${m}"`).join(', ')}. Your days: ${input.dayKeys.join(', ') || '(none)'}. If it is a new day (e.g. abs), it has to be created first with propose_create_day, then the order can include it.`,
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
      supabase.from('exercises').select('day_type, active').eq('user_id', args.userId),
      supabase
        .from('user_rotation')
        .select('*')
        .eq('user_id', args.userId)
        .maybeSingle(),
      supabase.from('user_flex_days').select('day_key').eq('user_id', args.userId),
    ])

  const dayKeys = enabledDayKeys(exerciseRows ?? [])
    .map(k => k.trim())
    .filter(Boolean)
    .sort()
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

  // Keep the user's place: find the day they last completed in the OLD order
  // and re-anchor the pointer to it in the new one, instead of reusing a raw
  // index that now points at a different day.
  const oldOrder = effectiveSequence(current, dayKeys, flexSet)
  const oldIndex = resolveRotationIndex(oldOrder, current)
  nextRow.current_index = resultingOrder.length
    ? resolveRotationIndex(resultingOrder, {
        current_index: oldIndex,
        current_day: dayAtIndex(oldOrder, oldIndex),
      })
    : -1

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
  // Goes through the shared writer so `current_day` is re-stamped with the
  // pointer; leaving the old anchor behind made "up next" jump after a reorder.
  const { error } = await writeRotationRow(supabase, {
    user_id: args.userId,
    mode: args.mode,
    sequence: args.sequence,
    current_index: args.currentIndex,
    current_day: dayAtIndex(args.sequence, args.currentIndex),
  })
  if (error) return { ok: false, message: error.message }
  return { ok: true }
}
