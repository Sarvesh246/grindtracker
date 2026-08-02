import { SupabaseClient } from '@supabase/supabase-js'
import { UserStats } from '@/lib/types'
import { getLevel } from '@/lib/utils/gamification'

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

export async function checkAndAwardBadges(
  supabase: SupabaseClient,
  userId: string,
  stats: UserStats,
  context: BadgeContext = {},
): Promise<string[]> {
  const { data: earned } = await supabase
    .from('user_badges')
    .select('badge_id')
    .eq('user_id', userId)
  const earnedSet = new Set((earned ?? []).map((b: { badge_id: string }) => b.badge_id))

  const { count: totalPRCount } = await supabase
    .from('session_logs')
    .select('sessions!inner(user_id)', { count: 'exact', head: true })
    .eq('is_pr', true)
    .eq('sessions.user_id', userId)

  const weekStart = getWeekStart()
  const { data: weekSessions } = await supabase
    .from('sessions')
    .select('day_type, local_date')
    .eq('user_id', userId)
    .not('completed_at', 'is', null)
    .gte('completed_at', weekStart.toISOString())

  const weekDayKeys = [...new Set(
    (weekSessions ?? []).map((s: { day_type: string }) => s.day_type)
  )]

  // Only query when there are day_keys to look up. Avoids a fragile sentinel
  // value (a real day could be named '__none__') and a pointless round-trip.
  const categoryRows = weekDayKeys.length > 0
    ? (await supabase
        .from('user_day_categories')
        .select('day_key, category')
        .eq('user_id', userId)
        .in('day_key', weekDayKeys)).data
    : []

  const categoryMap = new Map<string, string>(
    (categoryRows ?? []).map(r => [r.day_key, r.category])
  )
  // Fallback: if no mapping exists for a day_key, treat the key itself as the category
  // (handles users with standard push/pull/legs naming who never set categories)
  const resolvedCategories = new Set(weekDayKeys.map(k => categoryMap.get(k) ?? k))
  const hasFullSplit =
    resolvedCategories.has('push') &&
    resolvedCategories.has('pull') &&
    resolvedCategories.has('legs')

  // Weekday set for this week's completed sessions, from `local_date` (NOT
  // `completed_at`, which is UTC) — see CLAUDE.md "Dates & timezones". Parsed
  // at local noon like every other stored date key in this codebase.
  const weekdaySet = new Set(
    (weekSessions ?? [])
      .map((s: { local_date: string | null }) => s.local_date)
      .filter((d): d is string => !!d)
      .map(d => new Date(d + 'T12:00:00').getDay())
  )
  const hasWeekendBoth = weekdaySet.has(0) && weekdaySet.has(6) // Sun + Sat

  // The comeback badge: a 14+ day gap between this workout and the one before
  // it. The just-completed session is already in the DB by the time this
  // runs, so "the last two dates" are (this workout, the one before the gap).
  const { data: recentDates } = await supabase
    .from('sessions')
    .select('local_date')
    .eq('user_id', userId)
    .not('completed_at', 'is', null)
    .not('local_date', 'is', null)
    .order('local_date', { ascending: false })
    .limit(2)
  let hadComeback = false
  if (recentDates && recentDates.length === 2) {
    const [latest, prior] = recentDates as { local_date: string }[]
    const gapDays = (new Date(latest.local_date + 'T12:00:00').getTime()
      - new Date(prior.local_date + 'T12:00:00').getTime()) / 86_400_000
    hadComeback = gapDays >= 15 // 14 full empty days between them
  }

  // Lifetime aggregates the newer badges need (volume, heaviest/highest-rep
  // set ever, exercise variety, rest-day/friend/weight-log config) — one RPC
  // instead of pulling a user's whole history client-side on every finish.
  // See docs/sql/16-badge-metrics.sql.
  const { data: metricsData } = await supabase.rpc('grind_badge_metrics')
  const metrics = (metricsData ?? {}) as {
    total_volume?: number
    max_set_weight?: number
    max_set_reps?: number
    unique_exercise_count?: number
    has_recurring_rest_day?: boolean
    has_accepted_friend?: boolean
    body_weight_log_count?: number
  }

  const startHour = context.sessionStartedAt?.getHours()
  const totalPRs = totalPRCount ?? 0
  const currentLevel = getLevel(stats.xp_total)

  const conditions: Record<string, boolean> = {
    first_workout: stats.total_workouts >= 1,
    first_pr: totalPRs >= 1,
    streak_3: stats.current_streak >= 3,
    streak_7: stats.current_streak >= 7,
    streak_14: stats.current_streak >= 14,
    streak_30: stats.current_streak >= 30,
    streak_60: stats.current_streak >= 60,
    workouts_10: stats.total_workouts >= 10,
    workouts_50: stats.total_workouts >= 50,
    workouts_100: stats.total_workouts >= 100,
    workouts_200: stats.total_workouts >= 200,
    workouts_365: stats.total_workouts >= 365,
    all_three_days: hasFullSplit,
    weekend_warrior: hasWeekendBoth,
    pr_5: totalPRs >= 5,
    pr_25: totalPRs >= 25,
    pr_50: totalPRs >= 50,
    pr_100: totalPRs >= 100,
    level_5: currentLevel >= 5,
    level_10: currentLevel >= 10,
    level_15: currentLevel >= 15,
    level_20: currentLevel >= 20,
    volume_100k: (metrics.total_volume ?? 0) >= 100_000,
    volume_500k: (metrics.total_volume ?? 0) >= 500_000,
    volume_1m: (metrics.total_volume ?? 0) >= 1_000_000,
    plates_225: (metrics.max_set_weight ?? 0) >= 225,
    plates_315: (metrics.max_set_weight ?? 0) >= 315,
    plates_405: (metrics.max_set_weight ?? 0) >= 405,
    early_bird: startHour !== undefined && startHour < 7,
    night_owl: startHour !== undefined && startHour >= 22,
    comeback: hadComeback,
    flawless: context.hadNoSkips === true,
    rest_day_set: metrics.has_recurring_rest_day === true,
    not_alone: metrics.has_accepted_friend === true,
    rep_machine: (metrics.max_set_reps ?? 0) >= 20,
    weight_tracked: (metrics.body_weight_log_count ?? 0) >= 5,
  }

  const newlyEarned: string[] = []

  for (const [badgeId, condition] of Object.entries(conditions)) {
    if (condition && !earnedSet.has(badgeId)) {
      // Only report it as newly earned if the row actually persisted — otherwise
      // a transient failure (or a concurrent insert from another tab/device)
      // would still trigger the "badge earned!" celebration for a badge that
      // was never saved, and re-fire on every subsequent workout since
      // `earnedSet` would never come to include it.
      const { error } = await supabase.from('user_badges').insert({ user_id: userId, badge_id: badgeId })
      if (!error) newlyEarned.push(badgeId)
    }
  }

  // Meta badge: every OTHER badge earned, counting ones this same call just
  // awarded. Computed last so it can't earn itself off a stale snapshot.
  if (!earnedSet.has('completionist')) {
    const nowEarned = new Set([...earnedSet, ...newlyEarned])
    const allOthersEarned = ALL_BADGES
      .filter(b => b.id !== 'completionist')
      .every(b => nowEarned.has(b.id))
    if (allOthersEarned) {
      const { error } = await supabase.from('user_badges').insert({ user_id: userId, badge_id: 'completionist' })
      if (!error) newlyEarned.push('completionist')
    }
  }

  return newlyEarned
}

function getWeekStart(): Date {
  const now = new Date()
  const day = now.getDay()
  const diff = now.getDate() - day + (day === 0 ? -6 : 1)
  const monday = new Date(now)
  monday.setDate(diff)
  monday.setHours(0, 0, 0, 0)
  return monday
}
