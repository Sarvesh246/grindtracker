import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { PROFILE_COOKIE, profileCookieOptions } from '@/lib/setup/profileCookie'
import { isAdminEmail } from '@/lib/utils/admin'

/**
 * Nulls setup_completed_at and clears the proxy cookie so /setup runs again.
 * Does not wipe workouts, rest days, body weight, or preferences.
 */
export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // UI-only gate isn't enough — same admin allowlist as Feedback Inbox.
  if (!isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { error } = await supabase
    .from('user_profiles')
    .update({ setup_completed_at: null })
    .eq('id', user.id)

  if (error) {
    console.error('[grind] setup replay', error)
    return NextResponse.json({ error: 'Failed to reset setup' }, { status: 500 })
  }

  const res = NextResponse.json({ ok: true })
  // maxAge 0 clears the httpOnly cookie the client cannot touch.
  res.cookies.set(PROFILE_COOKIE, '', {
    ...profileCookieOptions(0),
    maxAge: 0,
  })
  return res
}
