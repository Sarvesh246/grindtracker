import { SupabaseClient } from '@supabase/supabase-js'
import { UserStats } from '@/lib/types'

export interface BadgeDefinition {
  id: string
  label: string
  emoji: string
  description: string
}

export const ALL_BADGES: BadgeDefinition[] = [
  { id: 'first_workout', label: 'First Rep', emoji: '🏋️', description: 'Complete your first workout' },
  { id: 'first_pr', label: 'Personal Best', emoji: '🏆', description: 'Log your first PR' },
  { id: 'streak_3', label: 'On A Roll', emoji: '🔥', description: '3-day streak' },
  { id: 'streak_7', label: 'Weekly Warrior', emoji: '💪', description: '7-day streak' },
  { id: 'streak_14', label: 'Fortnight', emoji: '🔥', description: '14-day streak' },
  { id: 'streak_30', label: 'Iron Habit', emoji: '⚡', description: '30-day streak' },
  { id: 'streak_60', label: 'Unbreakable', emoji: '⚡', description: '60-day streak' },
  { id: 'workouts_10', label: 'Consistent', emoji: '✅', description: '10 total workouts' },
  { id: 'workouts_50', label: 'Dedicated', emoji: '🎯', description: '50 total workouts' },
  { id: 'workouts_100', label: 'Elite', emoji: '👑', description: '100 total workouts' },
  { id: 'workouts_200', label: 'Grinder', emoji: '🛡️', description: '200 total workouts' },
  { id: 'workouts_365', label: 'Year One', emoji: '🎂', description: '365 total workouts' },
  { id: 'all_three_days', label: 'Full Split', emoji: '📅', description: 'Log Push, Pull, and Legs in one week' },
  { id: 'weekend_warrior', label: 'Weekend Warrior', emoji: '📅', description: 'Work out on both Saturday and Sunday in one week' },
  { id: 'pr_5', label: 'Getting Stronger', emoji: '📈', description: '5 total PRs logged' },
  { id: 'pr_25', label: 'Rising', emoji: '📈', description: '25 total PRs logged' },
  { id: 'pr_50', label: 'Powerhouse', emoji: '📊', description: '50 total PRs logged' },
  { id: 'pr_100', label: 'Record Breaker', emoji: '🏆', description: '100 total PRs logged' },
  { id: 'level_5', label: 'Locked In', emoji: '🎯', description: 'Reach Level 5' },
  { id: 'level_10', label: 'Icon', emoji: '⭐', description: 'Reach Level 10' },
  { id: 'level_15', label: 'Ascended', emoji: '💎', description: 'Reach Level 15' },
  { id: 'level_20', label: 'Immortal', emoji: '⚜️', description: 'Reach Level 20' },
  { id: 'volume_100k', label: '100K Club', emoji: '🏋️', description: '100,000 lbs of total volume lifted' },
  { id: 'volume_500k', label: '500K Club', emoji: '🏋️', description: '500,000 lbs of total volume lifted' },
  { id: 'volume_1m', label: 'Million Pound Club', emoji: '🏋️', description: '1,000,000 lbs of total volume lifted' },
  { id: 'plates_225', label: 'Two Plates', emoji: '⚫', description: 'Log a set at 225 lbs or more' },
  { id: 'plates_315', label: 'Three Plates', emoji: '⚫', description: 'Log a set at 315 lbs or more' },
  { id: 'plates_405', label: 'Four Plates', emoji: '⚫', description: 'Log a set at 405 lbs or more' },
  { id: 'early_bird', label: 'Early Bird', emoji: '🌅', description: 'Start a workout before 7 AM' },
  { id: 'night_owl', label: 'Night Owl', emoji: '🌙', description: 'Start a workout at 10 PM or later' },
  { id: 'comeback', label: 'The Comeback', emoji: '🔁', description: 'Return after a break of 14+ days' },
  { id: 'flawless', label: 'Flawless', emoji: '✨', description: 'Finish a workout without skipping a single set' },
  { id: 'rest_day_set', label: 'Smart Recovery', emoji: '🛌', description: 'Configure a recurring rest day' },
  { id: 'not_alone', label: 'Not Alone', emoji: '🤝', description: 'Add a friend' },
  { id: 'rep_machine', label: 'Rep Machine', emoji: '🔁', description: 'Log a set with 20 or more reps' },
  { id: 'weight_tracked', label: 'Tracked', emoji: '⚖️', description: 'Log your body weight 5 times' },
  { id: 'completionist', label: 'Completionist', emoji: '🏅', description: 'Earn every other badge' },
]

export interface BadgeContext {
  /** Local start time of the just-finished session — powers early_bird/night_owl. */
  sessionStartedAt?: Date
  /** True when the just-finished session had zero skipped sets. Powers `flawless`. */
  hadNoSkips?: boolean
}

/**
 * Server-side badge evaluation + insert (docs/sql/20-production-hardening.sql).
 * Clients no longer have INSERT privilege on `user_badges` — any UI-side insert
 * was a self-grant vector. The RPC re-checks every condition from live data.
 *
 * `userId` / `stats` are retained for call-site compatibility; the server ignores
 * client-supplied stats for award decisions.
 */
export async function checkAndAwardBadges(
  supabase: SupabaseClient,
  _userId: string,
  _stats: UserStats,
  context: BadgeContext = {},
): Promise<string[]> {
  const startHour =
    context.sessionStartedAt !== undefined
      ? context.sessionStartedAt.getHours()
      : null

  const { data, error } = await supabase.rpc('award_earned_badges', {
    p_start_hour: startHour,
    p_had_no_skips: context.hadNoSkips ?? null,
  })

  if (error) {
    console.error('[grind] award_earned_badges failed', error)
    return []
  }

  if (Array.isArray(data)) return data as string[]
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data) as string[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

/**
 * Un-award a batch of badges that `checkAndAwardBadges` just granted, after
 * the finish that earned them was undone (docs/sql/21-badge-session-fixes.sql).
 * Without this, re-finishing the same workout would satisfy the same
 * conditions but skip the insert (already earned) — so the badges the user
 * saw once would silently never reappear. Scoped server-side to the caller
 * and to badges earned in the last 15 minutes, so it can only unwind a
 * finish that just happened. Best-effort: never fail the undo over it.
 */
export async function revokeRecentBadges(
  supabase: SupabaseClient,
  badgeIds: string[],
): Promise<void> {
  if (badgeIds.length === 0) return
  const { error } = await supabase.rpc('revoke_recent_badges', { p_badge_ids: badgeIds })
  if (error) console.error('[grind] revoke_recent_badges failed', error)
}
