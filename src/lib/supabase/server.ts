import { cache } from 'react'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { User } from '@supabase/supabase-js'
import { withDeadline } from './deadline'

/**
 * Bound each server-side Supabase request. A request that never answers used
 * to hold the whole RSC render — and with it the client navigation the user
 * just tapped — until the function itself timed out, so a nav tab "did
 * nothing". Failing at 10s hands the page's existing retry / error states a
 * real error instead. Storage is exempt (large uploads).
 */
const SERVER_REQUEST_TIMEOUT_MS = 6_000

function timeoutFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url.includes('/storage/v1/')) return fetch(input, init)
  const timeout = AbortSignal.timeout(SERVER_REQUEST_TIMEOUT_MS)
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
  return fetch(input, { ...init, signal })
}

/** How long a navigation waits on the Auth server before using the verified token. */
const AUTH_USER_BUDGET_MS = 3_000

export const createClient = cache(async () => {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: timeoutFetch },
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
})

/** Per-request memo of `auth.getUser()` — layout + page both need it. */
export const getAuthUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient()

  // getUser() is a network round trip to the Auth server, and the layout awaits
  // it before anything paints. Give it a short budget; if it is slow or fails,
  // fall back to the session token the proxy already verified (signature and
  // expiry, locally), so one slow Auth call can't hold up every navigation.
  const slow = new Promise<null>(resolve => setTimeout(() => resolve(null), AUTH_USER_BUDGET_MS))
  const fresh = supabase.auth
    .getUser()
    .then(({ data: { user } }) => user)
    .catch(() => null)
  const user = await Promise.race([fresh, slow])
  if (user) return user

  // Deadline-wrapped for the same reason as the proxy: a failed refresh retries
  // for ~30s. (After the proxy ran the token is fresh, so this is local.)
  const { data } = await withDeadline(
    supabase.auth.getClaims(),
    AUTH_USER_BUDGET_MS,
    { data: null, error: null } as unknown as Awaited<ReturnType<typeof supabase.auth.getClaims>>,
  )
  const c = data?.claims
  if (!c?.sub) return null
  // Only the fields callers read (id, email, metadata) exist on a token.
  return {
    id: c.sub,
    email: c.email,
    aud: c.aud as string,
    user_metadata: c.user_metadata ?? {},
    app_metadata: c.app_metadata ?? {},
    created_at: '',
  } as User
})
