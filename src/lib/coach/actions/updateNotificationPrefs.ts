import type { SupabaseClient } from '@supabase/supabase-js'
import {
  notificationPrefsPatchIsEmpty,
  validateNotificationPrefsPatch,
  type NotificationPrefsPatch,
} from '@/lib/push/validatePrefs'
import { insertCoachProposal } from './proposals'
import { COACH_PROPOSAL_INSERT_FAILED } from './types'
import type { CoachActionPayload, CoachProposalView } from './types'

function hourLabel(hour: number): string {
  if (hour === 0) return '12am'
  if (hour === 12) return '12pm'
  return hour > 12 ? `${hour - 12}pm` : `${hour}am`
}

function summarizePatch(
  patch: NotificationPrefsPatch,
  current: Record<string, unknown> | null,
): string[] {
  const lines: string[] = []
  const flag = (key: keyof NotificationPrefsPatch, label: string) => {
    if (patch[key] === undefined) return
    const prev = current?.[key]
    const next = patch[key]
    if (typeof next === 'boolean') {
      lines.push(
        prev === next
          ? `${label}: ${next ? 'on' : 'off'}`
          : `${label}: ${prev === true ? 'on' : prev === false ? 'off' : '?'} → ${next ? 'on' : 'off'}`,
      )
    }
  }
  flag('enabled', 'Notifications')
  flag('rest_complete', 'Rest-complete alert')
  flag('rest_warning_10s', '10s rest warning')
  flag('workout_status', 'Workout status')
  flag('streak_reminder', 'Streak reminder')
  if (patch.streak_reminder_hour != null) {
    const prev = current?.streak_reminder_hour
    const next = patch.streak_reminder_hour
    lines.push(
      typeof prev === 'number' && prev !== next
        ? `Reminder hour: ${hourLabel(prev)} → ${hourLabel(next)}`
        : `Reminder hour: ${hourLabel(next)}`,
    )
  }
  if (patch.timezone) {
    const prev = typeof current?.timezone === 'string' ? current.timezone : null
    lines.push(
      prev && prev !== patch.timezone
        ? `Timezone: ${prev} → ${patch.timezone}`
        : `Timezone: ${patch.timezone}`,
    )
  }
  return lines
}

export async function previewUpdateNotificationPrefs(
  supabase: SupabaseClient,
  args: {
    userId: string
    conversationId: string | null
    body: Record<string, unknown>
  },
): Promise<
  | { ok: true; proposal: CoachProposalView }
  | { ok: false; reason: string }
> {
  const validated = validateNotificationPrefsPatch(args.body)
  if (!validated.ok) return { ok: false, reason: validated.reason }
  if (notificationPrefsPatchIsEmpty(validated.patch)) {
    return {
      ok: false,
      reason: 'Provide at least one notification setting to change.',
    }
  }

  const { data: current } = await supabase
    .from('notification_prefs')
    .select(
      'enabled, rest_complete, rest_warning_10s, workout_status, streak_reminder, streak_reminder_hour, timezone',
    )
    .eq('user_id', args.userId)
    .maybeSingle()

  const payload: CoachActionPayload = {
    kind: 'update_notification_prefs',
    card: {
      title: 'Update notifications',
      summaryLines: summarizePatch(
        validated.patch,
        (current as Record<string, unknown> | null) ?? null,
      ),
      riskNote:
        'Saves the same notification preferences as Profile → Settings. Rest-end alerts still need the app open on iOS.',
    },
    execute: { patch: validated.patch },
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

export async function executeUpdateNotificationPrefs(
  supabase: SupabaseClient,
  args: { userId: string; patch: NotificationPrefsPatch },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.from('notification_prefs').upsert(
    {
      user_id: args.userId,
      ...args.patch,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )
  if (error) return { ok: false, message: error.message }
  return { ok: true }
}
