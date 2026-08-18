import { cookies } from 'next/headers'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { readWithRetry } from '@/lib/supabase/readWithRetry'
import { redirect } from 'next/navigation'
import ProfileDashboard from './ProfileDashboard'
import { isAdminEmail } from '@/lib/utils/admin'
import {
  DEMO_IDENTITY,
  DEMO_JOINED_AT,
  DEMO_STATS,
  DEMO_BADGE_IDS,
  DEMO_TOTAL_PRS,
  DEMO_TOTAL_SETS,
  DEMO_DAYS_ACTIVE,
} from '@/lib/demoMode/fakeData'

export default async function ProfilePage() {
  const supabase = await createClient()

  const user = await getAuthUser()
  if (!user) redirect('/login')

  const demoModePref = (await cookies()).get('grind_demo_mode_pref')?.value
  const demoMode = demoModePref === 'on' && isAdminEmail(user.email)

  if (demoMode) {
    return (
      <ProfileDashboard
        displayName={DEMO_IDENTITY.displayName}
        avatarUrl={DEMO_IDENTITY.avatarUrl}
        username={DEMO_IDENTITY.username}
        joinedAt={DEMO_JOINED_AT}
        stats={DEMO_STATS}
        earnedBadgeIds={DEMO_BADGE_IDS}
        totalPRs={DEMO_TOTAL_PRS}
        totalSets={DEMO_TOTAL_SETS}
        activeDayTimestamps={[]}
        daysActive={DEMO_DAYS_ACTIVE}
        demoMode
      />
    )
  }

  const [
    statsRes,
    badgesRes,
    prsRes,
    setsRes,
    historyRes,
    profileRes,
  ] = await Promise.all([
    // Same guard as the home dashboard: every account is seeded a `user_stats`
    // row at signup (migration `11-server-side-xp.sql`), so a null row is a
    // failed read — one transient blip must not paint an established profile
    // as level 1 with no streak.
    readWithRetry(
      'profile:user_stats',
      () =>
        supabase
          .from('user_stats')
          .select('xp_total, level, current_streak, longest_streak, total_workouts')
          .eq('user_id', user.id)
          .maybeSingle(),
      { failed: r => r.error != null || r.data == null },
    ),
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
  ]).catch(err => {
    console.error('[grind] profile page load failed', err)
    return [null, null, null, null, null, null] as const
  })

  if (statsRes?.error) console.error('[grind] profile user_stats failed', statsRes.error)
  if (badgesRes?.error) console.error('[grind] profile user_badges failed', badgesRes.error)
  if (prsRes?.error) console.error('[grind] profile totalPRs failed', prsRes.error)
  if (setsRes?.error) console.error('[grind] profile totalSets failed', setsRes.error)
  if (historyRes?.error) console.error('[grind] grind_home_history failed', historyRes.error)
  if (profileRes?.error) console.error('[grind] profile user_profiles failed', profileRes.error)

  const earnedSet = new Set((badgesRes?.data ?? []).map(b => b.badge_id))
  const historyPayload = (historyRes?.data ?? {}) as { days_active?: number }
  // days_active is already DISTINCT local_date from the server — profile only
  // needs the count (was unbounded completed_at history before).
  const daysActive = historyPayload.days_active ?? 0

  const avatarUrl = user.user_metadata?.avatar_url ?? null
  const displayName = user.user_metadata?.full_name ?? user.email ?? 'Athlete'
  const rawStats = statsRes?.data
  const stats = {
    xp_total: Number(rawStats?.xp_total ?? 0) || 0,
    level: Number(rawStats?.level ?? 1) || 1,
    current_streak: Number(rawStats?.current_streak ?? 0) || 0,
    longest_streak: Number(rawStats?.longest_streak ?? 0) || 0,
    total_workouts: Number(rawStats?.total_workouts ?? 0) || 0,
  }

  return (
    <ProfileDashboard
      displayName={displayName}
      avatarUrl={avatarUrl}
      username={profileRes?.data?.username ?? null}
      joinedAt={profileRes?.data?.created_at ?? null}
      stats={stats}
      earnedBadgeIds={Array.from(earnedSet)}
      totalPRs={prsRes?.count ?? 0}
      totalSets={setsRes?.count ?? 0}
      activeDayTimestamps={[]}
      daysActive={daysActive}
    />
  )
}
