import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import FriendProfileView from './FriendProfileView'
import type { FriendProfile } from '@/lib/types'

/**
 * Read-only friend profile, reached by tapping a row on the leaderboard.
 * `get_friend_profile` (docs/sql/19-friend-profile.sql) is the real gate —
 * self or an accepted friend, everyone else gets NOT_VISIBLE — this page just
 * decides what to render for each outcome. Everyone reachable from an actual
 * leaderboard tap is already self-or-a-friend, so "unavailable" below really
 * only fires for a hand-typed or stale (unfriended) URL.
 */
export default async function FriendProfilePage({
  params,
}: {
  params: Promise<{ username: string }>
}) {
  const { username } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: targetProfile } = await supabase
    .from('user_profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle()

  // Viewing your own row from the leaderboard — send to the real (editable)
  // profile rather than maintaining a second read-only view of yourself.
  if (targetProfile && targetProfile.id === user.id) redirect('/profile')

  const { data, error } = targetProfile
    ? await supabase.rpc('get_friend_profile', { p_user_id: targetProfile.id })
    : { data: null, error: null }

  if (!targetProfile || error || !data) {
    return (
      <div className="page page--profile" style={{
        fontFamily: "'DM Sans', sans-serif",
        padding: '64px 24px',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '12px',
      }}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--border-strong)' }}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
        </svg>
        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '24px', color: 'var(--text-primary)', letterSpacing: '1px' }}>
          PROFILE UNAVAILABLE
        </div>
        <div style={{ fontSize: '14px', color: 'var(--text-muted)', lineHeight: 1.5, maxWidth: '280px' }}>
          This profile doesn&apos;t exist, or you&apos;re not friends with this person anymore.
        </div>
        <Link href="/leaderboard" style={{
          marginTop: '8px',
          fontSize: '13px',
          fontWeight: 600,
          color: 'var(--accent-text)',
          textDecoration: 'none',
        }}>
          Back to leaderboard
        </Link>
      </div>
    )
  }

  return <FriendProfileView profile={data as FriendProfile} />
}
