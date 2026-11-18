/**
 * Shared validation for notification preference patches.
 * Used by PATCH /api/push/prefs and Coach propose_update_notification_prefs
 * so the hour set and timezone check cannot drift apart.
 */

import { ALERT_KINDS } from '@/lib/energy/types'

export const STREAK_REMINDER_HOURS = new Set([17, 18, 19, 20, 21])
export const ENERGY_LEAD_MINUTES = new Set([10, 20, 30])

export type NotificationPrefsPatch = {
  enabled?: boolean
  rest_complete?: boolean
  rest_warning_10s?: boolean
  workout_status?: boolean
  streak_reminder?: boolean
  streak_reminder_hour?: number
  timezone?: string
  energy_alerts?: boolean
  energy_kinds?: string[]
  energy_lead_min?: number
}

const BOOL_KEYS = [
  'enabled',
  'rest_complete',
  'rest_warning_10s',
  'workout_status',
  'streak_reminder',
  'energy_alerts',
] as const

export function validateNotificationPrefsPatch(
  body: Record<string, unknown>,
):
  | { ok: true; patch: NotificationPrefsPatch }
  | { ok: false; reason: string } {
  const patch: NotificationPrefsPatch = {}

  for (const key of BOOL_KEYS) {
    if (key in body) {
      if (typeof body[key] !== 'boolean') {
        return { ok: false, reason: `${key} must be true or false.` }
      }
      patch[key] = body[key]
    }
  }

  if ('timezone' in body && body.timezone != null) {
    if (typeof body.timezone !== 'string' || !body.timezone.trim()) {
      return { ok: false, reason: 'timezone must be a non-empty IANA name.' }
    }
    const tz = body.timezone.trim().slice(0, 64)
    try {
      Intl.DateTimeFormat('en-US', { timeZone: tz })
      patch.timezone = tz
    } catch {
      return { ok: false, reason: 'Invalid timezone' }
    }
  }

  if ('streak_reminder_hour' in body && body.streak_reminder_hour != null) {
    const h = Math.round(Number(body.streak_reminder_hour))
    if (!STREAK_REMINDER_HOURS.has(h)) {
      return { ok: false, reason: 'streak_reminder_hour must be 17–21' }
    }
    patch.streak_reminder_hour = h
  }

  if ('energy_kinds' in body && body.energy_kinds != null) {
    const kinds = body.energy_kinds
    const known = new Set<string>(ALERT_KINDS)
    if (!Array.isArray(kinds) || !kinds.every((k) => typeof k === 'string' && known.has(k))) {
      return { ok: false, reason: `energy_kinds must be a subset of ${ALERT_KINDS.join(', ')}` }
    }
    patch.energy_kinds = [...new Set(kinds as string[])]
  }

  if ('energy_lead_min' in body && body.energy_lead_min != null) {
    const m = Math.round(Number(body.energy_lead_min))
    if (!ENERGY_LEAD_MINUTES.has(m)) {
      return { ok: false, reason: 'energy_lead_min must be 10, 20 or 30' }
    }
    patch.energy_lead_min = m
  }

  return { ok: true, patch }
}

export function notificationPrefsPatchIsEmpty(
  patch: NotificationPrefsPatch,
): boolean {
  return Object.keys(patch).length === 0
}
