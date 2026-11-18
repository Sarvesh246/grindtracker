export interface NotificationPrefs {
  user_id: string
  enabled: boolean
  rest_complete: boolean
  rest_warning_10s: boolean
  workout_status: boolean
  streak_reminder: boolean
  streak_reminder_hour: number
  timezone: string
  /** GRIND Energy heads-ups (migration 65). */
  energy_alerts: boolean
  energy_kinds: string[]
  energy_lead_min: number
  updated_at?: string
}

export const DEFAULT_NOTIFICATION_PREFS: Omit<NotificationPrefs, 'user_id' | 'updated_at'> = {
  enabled: false,
  rest_complete: true,
  rest_warning_10s: false,
  workout_status: true,
  streak_reminder: true,
  streak_reminder_hour: 19,
  timezone: 'UTC',
  energy_alerts: false,
  energy_kinds: ['morning_peak', 'afternoon_dip', 'evening_peak', 'wind_down'],
  energy_lead_min: 20,
}

export type ScheduleAction =
  | {
      action: 'upsert'
      kind: 'rest_end' | 'rest_warn'
      fireAt: string
      dedupeKey: string
      payload: Record<string, unknown>
    }
  | {
      action: 'cancel'
      /** Cancel all open rest_end/rest_warn for this session id prefix. */
      sessionId: string
    }
  | {
      action: 'cancel_keys'
      dedupeKeys: string[]
    }

export interface RestScheduleInput {
  sessionId: string
  exerciseId: string
  exerciseName: string
  endsAtMs: number
  durationSec: number
  prefs: Pick<NotificationPrefs, 'rest_complete' | 'rest_warning_10s' | 'enabled'>
}
