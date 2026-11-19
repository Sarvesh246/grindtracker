/**
 * GRIND Body: the shapes the watch's health data takes once it is stored
 * (migration 59). Everything in src/lib/body is pure — callers load rows and
 * pass them in — so the same math feeds Home, Progress, past workouts, the
 * Coach and the watch's /today.
 *
 * Display and advice only. Nothing here may feed XP, streaks, PRs or the
 * leaderboard (CLAUDE.md "Stats are server-authoritative").
 */

/** One `daily_body` row. Series are 96 buckets of 15 min from local midnight. */
export interface DailyBody {
  local_date: string
  bb_series?: (number | null)[] | null
  stress_series?: (number | null)[] | null
  bb_high: number | null
  bb_low: number | null
  bb_latest: number | null
  bb_wake: number | null
  stress_avg: number | null
  resting_hr: number | null
  recovery_hours: number | null
  steps?: number | null
  active_minutes?: number | null
  floors?: number | null
  spo2?: number | null
  vo2max?: number | null
  synced_at?: string | null
  /** Migration 69: all-day heart rate (bucket averages) and the day's running
   *  totals at the bucket each sync arrived in; absent before it. */
  hr_series?: (number | null)[] | null
  steps_series?: (number | null)[] | null
  active_series?: (number | null)[] | null
  floors_series?: (number | null)[] | null
  /** Migration 71: breaths per minute at the bucket each sync arrived in. */
  resp_series?: (number | null)[] | null
}

/** One stored watch snapshot (migration 69's body_sync_log). */
export interface BodySync {
  local_date: string
  received_at: string
  source: 'app' | 'background'
}

/** What training load needs from a finished session. */
export interface LoadSession {
  local_date: string | null
  started_at: string | null
  completed_at: string | null
  zone_seconds: number[] | null
}

/** A logged set with the heart rate the watch saw. */
export interface HrSet {
  exercise_id: string
  exercise_name?: string
  set_number: number
  weight: number | null
  reps: number | null
  hr_peak: number | null
  hr_end: number | null
  hr_rest_drop_60: number | null
  completed_at?: string | null
}

export const BUCKETS_PER_DAY = 96
export const BUCKET_MINUTES = 15
