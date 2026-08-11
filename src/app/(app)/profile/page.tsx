import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ProfileDashboard from './ProfileDashboard'

export default async function ProfilePage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [
    { data: stats },
    { data: earnedBadges },
    { count: totalPRs },
    { count: totalSets },
    { data: history },
    { data: profile },
  ] = await Promise.all([
    supabase.from('user_stats').select('*').eq('user_id', user.id).maybeSingle(),
    supabase.from('user_badges').select('badge_id, earned_at').eq('user_id', user.id),
    supabase
      .from('session_logs')
      .select('sessions!inner(user_id)', { count: 'exact', head: true })
      .eq('is_pr', true)
      .eq('sessions.user_id', user.id),
    supabase
      .from('session_logs')
      .select('sessions!inner(user_id, completed_at)', { count: 'exact', head: true })
      .eq('sessions.user_id', user.id)
      .not('sessions.completed_at', 'is', null)
      .eq('is_skipped', false)
      .not('weight', 'is', null),
    supabase.rpc('grind_home_history', { p_lookback_days: 7 }),
    supabase.from('user_profiles').select('username, created_at').eq('id', user.id).maybeSingle(),
  ])

  const earnedSet = new Set((earnedBadges ?? []).map(b => b.badge_id))
  const historyPayload = (history ?? {}) as { days_active?: number }
  // days_active is already DISTINCT local_date from the server — profile only
  // needs the count (was unbounded completed_at history before).
  const daysActive = historyPayload.days_active ?? 0

  const avatarUrl = user.user_metadata?.avatar_url ?? null
  const displayName = user.user_metadata?.full_name ?? user.email ?? 'Athlete'

  return (
    <ProfileDashboard
      displayName={displayName}
      avatarUrl={avatarUrl}
      username={profile?.username ?? null}
      joinedAt={profile?.created_at ?? null}
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
      activeDayTimestamps={[]}
      daysActive={daysActive}
    />
  )
}
