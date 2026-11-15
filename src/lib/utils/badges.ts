import { SupabaseClient } from '@supabase/supabase-js'
import { UserStats } from '@/lib/types'

export type BadgeWeightKind = 'volume' | 'plates'

export interface BadgeDefinition {
  id: string
  label: string
  emoji: string
  /** Fallback wording (always lbs). Prefer `formatBadgeDescription` when a
   * weight kind is set so the number renders in the user's display unit. */
  description: string
  /**
   * Canonical lbs amount used by `formatBadgeDescription`. Kept as plain
   * data (never a function) so badge objects stay RSC-serializable — passing
   * `formatDescription` closures from a Server Component into a Client
   * Component is what broke /profile (digest 4241374136).
   */
  weightLbs?: number
  weightKind?: BadgeWeightKind
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
  { id: 'volume_100k', label: '100K Club', emoji: '🏋️', description: '100,000 lbs of total volume lifted', weightLbs: 100000, weightKind: 'volume' },
  { id: 'volume_500k', label: '500K Club', emoji: '🏋️', description: '500,000 lbs of total volume lifted', weightLbs: 500000, weightKind: 'volume' },
  { id: 'volume_1m', label: 'Million Pound Club', emoji: '🏋️', description: '1,000,000 lbs of total volume lifted', weightLbs: 1000000, weightKind: 'volume' },
  { id: 'plates_225', label: 'Two Plates', emoji: '⚫', description: 'Log a set at 225 lbs or more', weightLbs: 225, weightKind: 'plates' },
  { id: 'plates_315', label: 'Three Plates', emoji: '⚫', description: 'Log a set at 315 lbs or more', weightLbs: 315, weightKind: 'plates' },
  { id: 'plates_405', label: 'Four Plates', emoji: '⚫', description: 'Log a set at 405 lbs or more', weightLbs: 405, weightKind: 'plates' },
  { id: 'early_bird', label: 'Early Bird', emoji: '🌅', description: 'Start a workout before 7 AM' },
  { id: 'night_owl', label: 'Night Owl', emoji: '🌙', description: 'Start a workout at 10 PM or later' },
  { id: 'comeback', label: 'The Comeback', emoji: '🔁', description: 'Return after a break of 14+ days' },
  { id: 'flawless', label: 'Flawless', emoji: '✨', description: 'Finish a workout without skipping a single set' },
  { id: 'rest_day_set', label: 'Smart Recovery', emoji: '🛌', description: 'Configure a recurring rest day' },
  { id: 'not_alone', label: 'Not Alone', emoji: '🤝', description: 'Add a friend' },
  { id: 'rep_machine', label: 'Rep Machine', emoji: '🔁', description: 'Log a set with 20 or more reps' },
  { id: 'weight_tracked', label: 'Tracked', emoji: '⚖️', description: 'Log your body weight 5 times' },
  // ── 57-badge-expansion.sql ──
  // Consistency
  { id: 'perfect_week', label: 'Perfect Week', emoji: '🗓️', description: 'Train or rest as planned every day of a week, with 3+ workouts' },
  { id: 'saved_it', label: 'Saved It', emoji: '🛟', description: 'Keep a streak alive with a one-off rest day' },
  { id: 'rest_day_pro', label: 'Rest Day Pro', emoji: '🛌', description: 'Take 10 rest days without breaking a streak' },
  { id: 'early_bird_regular', label: 'Early Bird Regular', emoji: '🌄', description: 'Start 10 workouts before 7 AM' },
  { id: 'night_owl_regular', label: 'Night Owl Regular', emoji: '🦉', description: 'Start 10 workouts at 10 PM or later' },
  // Training quality
  { id: 'warmup_ritual', label: 'Warm-Up Ritual', emoji: '🔥', description: 'Log warm-up sets in 25 workouts' },
  { id: 'triple_threat', label: 'Triple Threat', emoji: '🔺', description: 'Complete 10 Push, 10 Pull, and 10 Legs workouts' },
  { id: 'variety_pack', label: 'Variety Pack', emoji: '🎲', description: 'Log 25 different exercises' },
  { id: 'max_effort', label: 'Max Effort', emoji: '💥', description: 'Log 10 working sets at RPE 10' },
  // Progression
  { id: 'hat_trick', label: 'Hat Trick', emoji: '🎩', description: 'Set PRs on 3 different exercises in one workout' },
  { id: 'podium_push', label: 'Podium Push', emoji: '🥇', description: 'PR 5 different exercises in one calendar month' },
  // Body
  { id: 'daily_weigh_in', label: 'Daily Weigh-In', emoji: '⚖️', description: 'Log your body weight 14 days in a row' },
  { id: 'goal_getter', label: 'Goal Getter', emoji: '🎯', description: 'Lift past your target weight on 3 exercises' },
  { id: 'before_after', label: 'Before & After', emoji: '📸', description: 'Save 5 progress photos' },
  // Social
  { id: 'squad_goals', label: 'Squad Goals', emoji: '👥', description: 'Have 5 friends' },
  { id: 'podium', label: 'Podium', emoji: '🏅', description: 'Rank top 3 on any leaderboard tab (4+ on the board)' },
  { id: 'top_of_board', label: 'Top of the Board', emoji: '👑', description: 'Rank #1 on any leaderboard tab (3+ on the board)' },
  // App & ritual
  { id: 'off_the_grid', label: 'Off the Grid', emoji: '📴', description: 'Start a workout offline and finish it after it syncs' },
  { id: 'coached', label: 'Coached', emoji: '🧠', description: 'Apply a weekly plan from the Coach' },
  { id: 'holiday_grind', label: 'Holiday Grind', emoji: '🎄', description: 'Train on a US federal holiday' },
  { id: 'own_your_data', label: 'Own Your Data', emoji: '📦', description: 'Export your GRIND data' },
  { id: 'speak_up', label: 'Speak Up', emoji: '💬', description: 'Send feedback from the app' },
  { id: 'completionist', label: 'Completionist', emoji: '🏅', description: 'Earn every other badge' },
]

/** Rebuilds a badge's description in the caller's active display unit. */
export function formatBadgeDescription(
  badge: BadgeDefinition,
  fmtWeight: (canonicalLbs: number) => string,
  unitLabel: string,
): string {
  if (badge.weightLbs == null || !badge.weightKind) return badge.description
  if (badge.weightKind === 'volume') {
    return `${fmtWeight(badge.weightLbs)} ${unitLabel} of total volume lifted`
  }
  return `Log a set at ${fmtWeight(badge.weightLbs)} ${unitLabel} or more`
}

/**
 * Server-side badge evaluation + insert (docs/sql/38-schema-integrity.sql).
 * Clients no longer have INSERT privilege on `user_badges` — any UI-side insert
 * was a self-grant vector. The RPC re-checks every condition from live data,
 * including early_bird / night_owl / flawless (from `sessions.start_hour` and
 * skip rows). Do not send a client hour or skip flag.
 *
 * `userId` / `stats` are retained for call-site compatibility; the server ignores
 * client-supplied stats for award decisions.
 */
export async function checkAndAwardBadges(
  supabase: SupabaseClient,
  _userId: string,
  _stats: UserStats,
): Promise<string[]> {
  const { data, error } = await supabase.rpc('award_earned_badges')

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
