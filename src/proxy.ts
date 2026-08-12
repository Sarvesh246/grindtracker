import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import {
  isProfileCookieForUser,
  PROFILE_COOKIE,
  PROFILE_COOKIE_MAX_AGE,
  profileCookieOptions,
  profileCookieValue,
} from '@/lib/setup/profileCookie'

/**
 * Marks "this user finished first-run setup" (`setup_completed_at` set).
 *
 * The check used to be a `user_profiles` SELECT on every authenticated request
 * and only meant "row exists". It still caches once setup is complete (rarely
 * flips except Replay Setup / data delete), so forging the cookie only skips
 * setup — every read is still bounded by RLS.
 */

/** Paths that never need an auth decision. */
function isPublicPath(pathname: string): boolean {
  return (
    // Exact `/` only — marketing landing. Deep links still require auth so
    // unauthenticated hits to /home, /log, etc. redirect straight to /login.
    pathname === '/' ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/auth') ||
    // Cron authenticates via CRON_SECRET bearer, not the user session.
    pathname.startsWith('/api/cron')
  )
}

/** Setup UI + its complete/replay routes must stay reachable mid-wizard. */
function isSetupPath(pathname: string): boolean {
  return pathname.startsWith('/setup') || pathname.startsWith('/api/setup')
}

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // `getClaims()` rather than `getUser()`.
  //
  // `getUser()` makes a network round trip to the Supabase Auth server on every
  // single request — at a few thousand users that is the dominant source of
  // navigation latency and auth-endpoint load. `getClaims()` verifies the JWT
  // signature locally against a cached JWKS when the project uses asymmetric
  // signing keys (the default for new projects), and transparently falls back
  // to a server call when it can't. Either way the token is cryptographically
  // verified — this is not the "trust the cookie" shortcut that `getSession()`
  // would be.
  const { data: claims } = await supabase.auth.getClaims()
  const userId = claims?.claims?.sub ?? null

  const { pathname } = request.nextUrl

  if (!userId && !isPublicPath(pathname)) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (userId && !isSetupPath(pathname) && !isPublicPath(pathname)) {
    if (isProfileCookieForUser(request.cookies.get(PROFILE_COOKIE)?.value, userId)) {
      // Already verified setup-complete for this user — skip the DB round trip.
      return supabaseResponse
    }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('id, setup_completed_at')
      .eq('id', userId)
      .maybeSingle()

    if (!profile || !profile.setup_completed_at) {
      return NextResponse.redirect(new URL('/setup', request.url))
    }

    // Cache against the user id, so switching accounts on a shared device
    // re-verifies rather than inheriting the previous user's flag.
    supabaseResponse.cookies.set(
      PROFILE_COOKIE,
      profileCookieValue(userId),
      profileCookieOptions(PROFILE_COOKIE_MAX_AGE),
    )
  }

  return supabaseResponse
}

export const config = {
  // Exclude static assets and PWA files. Each excluded path is one fewer
  // middleware invocation — which on Vercel is both latency and billed compute.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|offline.html|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|ttf)$).*)',
  ],
}
