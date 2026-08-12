import type { SupabaseClient } from '@supabase/supabase-js'
import { insertCoachProposal } from './proposals'
import type { CoachActionPayload, CoachProposalView } from './types'

function normalizeDayKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ')
}

export async function previewStartWorkout(
  supabase: SupabaseClient,
  args: {
    userId: string
    conversationId: string | null
    dayType?: string | null
  },
): Promise<
  | { ok: true; proposal: CoachProposalView }
  | { ok: false; reason: string }
> {
  const { data: exercises } = await supabase
    .from('exercises')
    .select('day_type')
    .eq('user_id', args.userId)
    .eq('active', true)

  const dayKeys = [
    ...new Set(
      (exercises ?? [])
        .map(e => String(e.day_type ?? '').trim())
        .filter(Boolean),
    ),
  ]

  if (dayKeys.length === 0) {
    return {
      ok: false,
      reason: 'You have no active workout days yet. Create a day first.',
    }
  }

  let dayType = args.dayType ? normalizeDayKey(args.dayType) : ''
  let resolvedFrom: 'explicit' | 'next_day' = 'explicit'

  if (dayType) {
    const hit = dayKeys.find(k => normalizeDayKey(k) === dayType)
    if (!hit) {
      const partial = dayKeys.filter(k =>
        normalizeDayKey(k).includes(dayType),
      )
      if (partial.length === 1) {
        dayType = partial[0]!
      } else {
        return {
          ok: false,
          reason: `No day named "${args.dayType}". Your days: ${dayKeys.join(', ')}.`,
        }
      }
    } else {
      dayType = hit
    }
  } else {
    resolvedFrom = 'next_day'
    const { data: rotation } = await supabase
      .from('user_rotation')
      .select('mode, sequence, current_index')
      .eq('user_id', args.userId)
      .maybeSingle()

    if (
      rotation?.sequence &&
      Array.isArray(rotation.sequence) &&
      rotation.sequence.length > 0
    ) {
      const seq = rotation.sequence as string[]
      const idx =
        typeof rotation.current_index === 'number'
          ? rotation.current_index
          : 0
      // next slot after last completed pointer
      const nextIdx = (idx + 1) % seq.length
      const candidate = String(seq[nextIdx] ?? seq[0] ?? '').trim()
      if (candidate && dayKeys.includes(candidate)) {
        dayType = candidate
      }
    }

    if (!dayType) {
      // Fall back to least-recently trained among active days.
      const { data: lastByDay } = await supabase
        .from('sessions')
        .select('day_type, local_date')
        .eq('user_id', args.userId)
        .not('completed_at', 'is', null)
        .order('local_date', { ascending: false })
        .limit(60)

      const lastMap = new Map<string, string>()
      for (const row of lastByDay ?? []) {
        const key = String(row.day_type)
        if (!lastMap.has(key)) lastMap.set(key, String(row.local_date))
      }
      dayType = [...dayKeys].sort((a, b) => {
        const da = lastMap.get(a) ?? '0000-00-00'
        const db = lastMap.get(b) ?? '0000-00-00'
        return da.localeCompare(db)
      })[0]!
    }
  }

  const payload: CoachActionPayload = {
    kind: 'start_workout',
    card: {
      title: 'Start workout',
      summaryLines: [
        `Day: ${dayType}`,
        resolvedFrom === 'next_day'
          ? 'Resolved from your rotation / schedule'
          : 'Day you asked for',
        'Opens Active Workout after you confirm',
      ],
      riskNote: null,
    },
    execute: {
      dayType,
      resolvedFrom,
    },
  }

  const proposal = await insertCoachProposal(supabase, {
    userId: args.userId,
    conversationId: args.conversationId,
    payload,
  })
  if (!proposal) {
    return {
      ok: false,
      reason:
        'Could not save the proposal. Apply docs/sql/36-coach-actions.sql if you have not yet.',
    }
  }
  return { ok: true, proposal }
}

export async function executeStartWorkout(
  supabase: SupabaseClient,
  dayType: string,
): Promise<
  | { ok: true; href: string; resumed: boolean }
  | { ok: false; message: string }
> {
  const { data, error } = await supabase.rpc('start_or_resume_session', {
    p_day_type: dayType,
  })
  if (error || !data) {
    return {
      ok: false,
      message: error?.message ?? 'Could not start the workout.',
    }
  }
  const resumed = Boolean((data as { resumed?: boolean }).resumed)
  return {
    ok: true,
    href: `/log?day=${encodeURIComponent(dayType)}`,
    resumed,
  }
}
