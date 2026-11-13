import { createBrowserClient } from '@supabase/ssr'
import { navigatorLock } from '@supabase/supabase-js'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { browserIsOffline, withOfflineFastFail } from '@/lib/offline/offlineGate'
import { lastKnownUserId, rememberUserId } from '@/lib/offline/localSession'

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

/**
 * Auth-token lock. supabase-js's background refresh tick asks for the lock with
 * a 0ms timeout and expects "someone else has it" to mean "skip this tick" —
 * but the stock navigatorLock throws instead, which surfaced as an uncaught
 * "Acquiring an exclusive Navigator LockManager lock immediately failed"
 * whenever a second tab / resumed PWA held it. Skip quietly in that case; every
 * real caller (timeout > 0) keeps the library behaviour.
 */
async function authLock<R>(name: string, acquireTimeout: number, fn: () => Promise<R>): Promise<R> {
  if (acquireTimeout === 0 && typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(
      name,
      { mode: 'exclusive', ifAvailable: true },
      async lock => (lock ? fn() : (undefined as R)),
    )
  }
  return navigatorLock(name, acquireTimeout, fn)
}

export function createClient() {
  // Singleton in the browser (@supabase/ssr default), so these options apply
  // to the one shared client every component gets.
  return withOfflineFastFail(
    createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: { fetch: timeoutFetch },
        auth: {
          // Default is 5s before an orphaned Web Lock is stolen. iOS suspends a
          // backgrounded PWA mid-refresh often enough that the first taps after
          // resume each paid that 5s — the "discard got stuck" feel.
          lockAcquireTimeout: 2_000,
          lock: authLock,
        },
      },
    ),
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
  // Offline: an expired token can't refresh, and supabase-js retries that for
  // ~30s before answering. The remembered id is all callers need (RLS, not this
  // value, authorizes writes), so answer instantly from it.
  if (browserIsOffline()) {
    const id = lastKnownUserId()
    if (id) return { id } as User
  }
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user) {
      rememberUserId(session.user.id)
      return session.user
    }
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
