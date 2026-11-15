import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import {
  isProfileCookieForUser,
  PROFILE_COOKIE,
  PROFILE_COOKIE_MAX_AGE,
  profileCookieOptions,
  profileCookieValue,
} from '@/lib/setup/profileCookie'
import { isTransientAuthError } from '@/lib/supabase/authErrors'
import { withDeadline } from '@/lib/supabase/deadline'

/**
 * Bound everything the proxy asks of Supabase. It runs in front of EVERY page
 * navigation. The PWA resumes with an expired access token, so `getClaims()`
 * has to refresh it; supabase-js retries a failed refresh with back-off for
 * ~30s, so on a bad connection a tab tap sat dead for that long.
 *
 * Two layers, because each alone is not enough: a per-request timeout stops one
 * hung request, and the deadline stops the retry loop that wraps them.
 */
const PROXY_REQUEST_TIMEOUT_MS = 4_000
const AUTH_CHECK_DEADLINE_MS = 4_500

const AUTH_CHECK_TIMED_OUT = {
  data: null,
  error: { name: 'TimeoutError', message: 'auth check timed out' },
} as const

/** Shown when auth can't be checked in time. A 5xx is also what makes the
 *  service worker answer with the last saved copy of the page instead. */
function authUnavailablePage(): NextResponse {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GRIND</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0f0f0f;color:#f0f0f0;font:16px system-ui,sans-serif;text-align:center">
<main style="padding:24px"><h1 style="font-size:20px;margin:0 0 8px">Can't reach GRIND right now</h1>
<p style="color:#a3a3a3;margin:0 0 20px">Your data is safe. Check your connection and try again.</p>
<button onclick="location.reload()" style="background:#c8f135;color:#0f0f0f;border:0;border-radius:12px;padding:12px 20px;font:700 16px system-ui,sans-serif">Try again</button></main>`
  return new NextResponse(html, {
    status: 503,
    headers: { 'content-type': 'text/html; charset=utf-8', 'retry-after': '5', 'cache-control': 'no-store' },
  })
}

function timeoutFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const timeout = AbortSignal.timeout(PROXY_REQUEST_TIMEOUT_MS)
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
  return fetch(input, { ...init, signal })
}

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
      global: { fetch: timeoutFetch },
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
  const { data: claims, error: claimsError } = await withDeadline(
    supabase.auth.getClaims(),
    AUTH_CHECK_DEADLINE_MS,
    AUTH_CHECK_TIMED_OUT as unknown as Awaited<ReturnType<typeof supabase.auth.getClaims>>,
  )
  const userId = claims?.claims?.sub ?? null

  const { pathname } = request.nextUrl

  // "Couldn't reach Supabase" is not "signed out": redirecting would bounce an
  // established user to /login on every flaky launch. But letting the request
  // through is no better, because the page would try (and retry) the same
  // refresh itself. Fail fast instead.
  if (!userId && !isPublicPath(pathname) && isTransientAuthError(claimsError)) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Auth temporarily unavailable' }, { status: 503 })
    }
    return authUnavailablePage()
  }

  if (!userId && !isPublicPath(pathname)) {
    // API callers need JSON, not a login HTML redirect (which fetch treats as
    // a 200 and then fails to parse).
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (userId && pathname === '/login') {
    return NextResponse.redirect(new URL('/home', request.url))
  }

  if (userId && !isSetupPath(pathname) && !isPublicPath(pathname)) {
    if (isProfileCookieForUser(request.cookies.get(PROFILE_COOKIE)?.value, userId)) {
      // Already verified setup-complete for this user — skip the DB round trip.
      return supabaseResponse
    }

    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('id, setup_completed_at')
      .eq('id', userId)
      .maybeSingle()

    // A failed read says nothing about the profile. Let the request through
    // (RLS still bounds every read) without caching, so the next navigation
    // re-checks, rather than sending an established user back to /setup.
    if (profileError) return supabaseResponse

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
