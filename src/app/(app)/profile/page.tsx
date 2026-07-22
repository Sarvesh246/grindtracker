import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ProfileDashboard from './ProfileDashboard'
import { ALL_BADGES } from '@/lib/utils/badges'
import { isAdminEmail } from '@/lib/utils/admin'

export default async function ProfilePage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // User stats
  const { data: stats } = await supabase
    .from('user_stats')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  // Earned badges
  const { data: earnedBadges } = await supabase
    .from('user_badges')
    .select('badge_id, earned_at')
    .eq('user_id', user.id)

  const earnedSet = new Set((earnedBadges ?? []).map(b => b.badge_id))

  // Total PR count
  const { count: totalPRs } = await supabase
    .from('session_logs')
    .select('sessions!inner(user_id)', { count: 'exact', head: true })
    .eq('is_pr', true)
    .eq('sessions.user_id', user.id)

  // Total sets completed
  const { count: totalSets } = await supabase
    .from('session_logs')
    .select('sessions!inner(user_id, completed_at)', { count: 'exact', head: true })
    .eq('sessions.user_id', user.id)
    .not('sessions.completed_at', 'is', null)

  // Active-day timestamps. Distinct local days are derived client-side so the
  // count matches the user's timezone (consistent with the calendar/streak),
  // rather than the server's UTC day which can split or merge days at midnight.
  const { data: activeDays } = await supabase
    .from('sessions')
    .select('completed_at')
    .eq('user_id', user.id)
    .not('completed_at', 'is', null)

  const activeDayTimestamps = (activeDays ?? [])
    .map(s => s.completed_at)
    .filter((t): t is string => t !== null)

  // Google avatar + display name from user metadata
  const avatarUrl = user.user_metadata?.avatar_url ?? null
  const displayName = user.user_metadata?.full_name ?? user.email ?? 'Athlete'

  // Public profile (username)
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('username')
    .eq('id', user.id)
    .maybeSingle()

  return (
    <ProfileDashboard
      displayName={displayName}
      avatarUrl={avatarUrl}
      username={profile?.username ?? null}
      stats={stats ?? {
        xp_total: 0,
        level: 1,
        current_streak: 0,
        longest_streak: 0,
        total_workouts: 0,
      }}
      earnedBadgeIds={Array.from(earnedSet)}
      totalPRs={totalPRs ?? 0}
      totalSets={totalSets ?? 0}
      activeDayTimestamps={activeDayTimestamps}
      allBadges={ALL_BADGES}
      // Controls only whether the inbox link is rendered — /admin/feedback
      // guards itself and RLS is the real gate. See lib/utils/admin.ts.
      isAdmin={isAdminEmail(user.email)}
    />
  )
}
