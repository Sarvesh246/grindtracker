/**
 * Shared validation for notification preference patches.
 * Used by PATCH /api/push/prefs and Coach propose_update_notification_prefs
 * so the hour set and timezone check cannot drift apart.
 */

export const STREAK_REMINDER_HOURS = new Set([17, 18, 19, 20, 21])

export type NotificationPrefsPatch = {
  enabled?: boolean
  rest_complete?: boolean
  rest_warning_10s?: boolean
  workout_status?: boolean
  streak_reminder?: boolean
  streak_reminder_hour?: number
  timezone?: string
}

const BOOL_KEYS = [
  'enabled',
  'rest_complete',
  'rest_warning_10s',
  'workout_status',
  'streak_reminder',
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

  return { ok: true, patch }
}

export function notificationPrefsPatchIsEmpty(
  patch: NotificationPrefsPatch,
): boolean {
  return Object.keys(patch).length === 0
}
