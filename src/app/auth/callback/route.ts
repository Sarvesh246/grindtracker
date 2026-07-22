import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  // The provider reports a refused/cancelled consent here rather than sending a
  // code. Surface it instead of bouncing to a login page that looks like it
  // simply forgot the attempt.
  const oauthError = searchParams.get('error_description') ?? searchParams.get('error')
  if (oauthError) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(oauthError)}`
    )
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  // Previously the result was discarded: a failed exchange fell through to `/`,
  // which the proxy bounced straight back to `/login` with no explanation —
  // an unreportable, undebuggable loop for the user.
  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`
    )
  }

  // Always redirect to a path on THIS origin. `origin` is derived from the
  // request URL rather than a caller-supplied `next` param, so there is no
  // open-redirect surface here — keep it that way if a return path is ever added.
  return NextResponse.redirect(`${origin}/`)
}
