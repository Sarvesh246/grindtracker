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
  { id: 'streak_30', label: 'Iron Habit', emoji: '⚡', description: '30-day streak' },
  { id: 'workouts_10', label: 'Consistent', emoji: '✅', description: '10 total workouts' },
  { id: 'workouts_50', label: 'Dedicated', emoji: '🎯', description: '50 total workouts' },
  { id: 'workouts_100', label: 'Elite', emoji: '👑', description: '100 total workouts' },
  { id: 'all_three_days', label: 'Full Split', emoji: '📅', description: 'Log Push, Pull, and Legs in one week' },
  { id: 'pr_5', label: 'Getting Stronger', emoji: '📈', description: '5 total PRs logged' },
  { id: 'pr_25', label: 'Beast Mode', emoji: '🦁', description: '25 total PRs logged' },
  { id: 'level_5', label: 'Grind Mode', emoji: '💎', description: 'Reach Level 5 (2,000 XP)' },
]

export async function checkAndAwardBadges(
  supabase: SupabaseClient,
  userId: string,
  stats: UserStats,
  sessionPRCount: number,
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
    .select('day_type')
    .eq('user_id', userId)
    .not('completed_at', 'is', null)
    .gte('completed_at', weekStart.toISOString())
  const weekDayTypes = new Set((weekSessions ?? []).map((s: { day_type: string }) => s.day_type))
  const hasFullSplit = weekDayTypes.has('push') && weekDayTypes.has('pull') && weekDayTypes.has('legs')

  const totalPRs = totalPRCount ?? 0

  const conditions: Record<string, boolean> = {
    first_workout: stats.total_workouts >= 1,
    first_pr: totalPRs >= 1,
    streak_3: stats.current_streak >= 3,
    streak_7: stats.current_streak >= 7,
    streak_30: stats.current_streak >= 30,
    workouts_10: stats.total_workouts >= 10,
    workouts_50: stats.total_workouts >= 50,
    workouts_100: stats.total_workouts >= 100,
    all_three_days: hasFullSplit,
    pr_5: totalPRs >= 5,
    pr_25: totalPRs >= 25,
    level_5: stats.xp_total >= 2000,
  }

  const newlyEarned: string[] = []

  for (const [badgeId, condition] of Object.entries(conditions)) {
    if (condition && !earnedSet.has(badgeId)) {
      await supabase.from('user_badges').insert({ user_id: userId, badge_id: badgeId })
      newlyEarned.push(badgeId)
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
