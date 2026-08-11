import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  PROFILE_COOKIE,
  PROFILE_COOKIE_MAX_AGE,
  profileCookieOptions,
  profileCookieValue,
} from '@/lib/setup/profileCookie'

/**
 * Stamps setup_completed_at and sets the proxy cookie so Home is reachable.
 * Client must already have a user_profiles row (identity step).
 */
export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile, error: loadErr } = await supabase
    .from('user_profiles')
    .select('id, username')
    .eq('id', user.id)
    .maybeSingle()

  if (loadErr) {
    console.error('[grind] setup complete load', loadErr)
    return NextResponse.json({ error: 'Failed to load profile' }, { status: 500 })
  }
  if (!profile?.username) {
    return NextResponse.json(
      { error: 'Claim a username before finishing setup' },
      { status: 400 },
    )
  }

  const completedAt = new Date().toISOString()
  const { error: updateErr } = await supabase
    .from('user_profiles')
    .update({ setup_completed_at: completedAt })
    .eq('id', user.id)

  if (updateErr) {
    console.error('[grind] setup complete update', updateErr)
    return NextResponse.json({ error: 'Failed to complete setup' }, { status: 500 })
  }

  const res = NextResponse.json({ ok: true, setup_completed_at: completedAt })
  res.cookies.set(
    PROFILE_COOKIE,
    profileCookieValue(user.id),
    profileCookieOptions(PROFILE_COOKIE_MAX_AGE),
  )
  return res
}
