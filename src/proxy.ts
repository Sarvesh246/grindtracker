import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Marks "this user has completed username setup".
 *
 * The profile-existence check used to run as a `user_profiles` SELECT on EVERY
 * authenticated request. It can only ever flip once (no profile → profile) and
 * never back, so the result is cached here instead. Forging this cookie only
 * skips your own onboarding — it grants no data access, since every read is
 * still bounded by RLS.
 */
const PROFILE_COOKIE = 'grind_profile_ok'
const PROFILE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/** Paths that never need an auth decision. */
function isPublicPath(pathname: string): boolean {
  return (
    pathname.startsWith('/login') ||
    pathname.startsWith('/auth')
  )
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

  if (
    userId &&
    !pathname.startsWith('/setup') &&
    !isPublicPath(pathname)
  ) {
    if (request.cookies.get(PROFILE_COOKIE)?.value === userId) {
      // Already verified for this user — skip the database round trip.
      return supabaseResponse
    }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle()

    if (!profile) {
      return NextResponse.redirect(new URL('/setup', request.url))
    }

    // Cache against the user id, so switching accounts on a shared device
    // re-verifies rather than inheriting the previous user's flag.
    supabaseResponse.cookies.set(PROFILE_COOKIE, userId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: PROFILE_COOKIE_MAX_AGE,
    })
  }

  return supabaseResponse
}

export const config = {
  // Exclude static assets and PWA files. Each excluded path is one fewer
  // middleware invocation — which on Vercel is both latency and billed compute.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff|woff2|ttf)$).*)',
  ],
}
