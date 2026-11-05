import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient, User } from '@supabase/supabase-js'

/**
 * Upper bound on a single REST / RPC / auth request from the browser.
 *
 * supabase-js has no request timeout of its own. On a gym's flaky signal a
 * request can sit "pending" forever — and because the auth token refresh runs
 * inside the auth lock, one hung refresh used to stall *every* later call
 * (discard, finish, nav-triggered reads) until the app was killed. A bounded
 * fetch turns that into an ordinary error the existing retry / toast paths
 * already handle. Storage uploads (progress photos, feedback images) are
 * exempt: a large photo on a slow uplink legitimately takes longer.
 */
const REQUEST_TIMEOUT_MS = 15_000

export function makeTimeoutFetch(
  timeoutMs: number,
  baseFetch: typeof fetch = (...args) => fetch(...args),
): typeof fetch {
  return (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('/storage/v1/')) return baseFetch(input, init)

    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(new DOMException('Request timed out', 'TimeoutError')),
      timeoutMs,
    )
    const callerSignal = init?.signal
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort(callerSignal.reason)
      else callerSignal.addEventListener('abort', () => controller.abort(callerSignal.reason), { once: true })
    }
    return baseFetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer))
  }
}

const timeoutFetch = makeTimeoutFetch(REQUEST_TIMEOUT_MS)

export function createClient() {
  // Singleton in the browser (@supabase/ssr default), so these options apply
  // to the one shared client every component gets.
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: timeoutFetch },
      auth: {
        // Default is 5s before an orphaned Web Lock is stolen. iOS suspends a
        // backgrounded PWA mid-refresh often enough that the first taps after
        // resume each paid that 5s — the "discard got stuck" feel.
        lockAcquireTimeout: 2_000,
      },
    },
  )
}

/**
 * The signed-in user for client-side writes, read from the local session.
 *
 * `auth.getUser()` is a network round trip to the Auth server on every call;
 * the client only ever needs the id to stamp `user_id` on its own rows, and
 * RLS (not this value) is what authorizes the write. The session is the same
 * JWT the request will carry anyway. Falls back to `getUser()` only when no
 * local session exists, so a genuinely signed-out device still lands on
 * /login.
 */
export async function getClientUser(supabase: SupabaseClient): Promise<User | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user) return session.user
  } catch {
    // fall through to the network check
  }
  try {
    const { data: { user } } = await supabase.auth.getUser()
    return user
  } catch {
    return null
  }
}
