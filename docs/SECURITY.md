# GRIND security model

Moved out of [CLAUDE.md](../CLAUDE.md) to keep that file short; its text is unchanged. Section references like "Dates & timezones" or "Units" refer to CLAUDE.md.

## Security model
- **RLS is the boundary, never the UI.** Route guards (`isAdminEmail`) only pick
  404-vs-render; `is_grind_admin()` in Postgres is the real gate.
- **`security definer` functions bypass RLS**, so each one must authorize its own
  caller and pin `set search_path`. `get_leaderboard` intersects the requested
  ids with the caller's accepted friendships — it previously trusted the client's
  array, which let any user read any other user's stats by uuid (fixed in `10`).
- **Never trust a client-supplied number that feeds a leaderboard.** Derive it.
- **A single `FOR ALL` policy is rarely right for a table two parties share.**
  `friendships` had one, testing only "am I involved in this row" — which let a
  requester accept their own request and let anyone insert a pre-accepted
  friendship naming someone else as requester (fixed in `12`). Split by command
  and assert what each one actually means: who may create, who may approve.
- **Watch API (`/api/watch/v1`, [watch-api.md](watch-api.md))** authenticates
  with a per-device Bearer token, not a Supabase session, so its routes use the
  service-role key. That is safe only because every watch RPC
  (`watch_authenticate`, `watch_today_context`, `watch_sync_session`) is revoked
  from `anon`/`authenticated` and granted to `service_role` alone: they take a
  user id, and only the route — which derived it from the token hash — may pass
  one. `watch_sync_session` re-checks that every exercise and set id belongs to
  that user. Tokens are 244-bit random and stored as SHA-256 only; the proxy
  lets `/api/watch/` through without a session.
- **Never tell "API caller" from "definer RPC" with `session_user`.** PostgREST
  logs in as `authenticator` and `SET ROLE`s to `authenticated`, so
  `current_user <> session_user` is true for *every* REST call.
  `grind_guard_session_write` relied on it and let anyone insert pre-completed
  sessions with arbitrary XP (fixed in `88`). Gate on
  `current_user in ('authenticated', 'anon')` — definer RPCs run as their owner,
  watch routes as `service_role`.
- **Client-chosen URLs the server fetches need an allowlist.** Push endpoints are
  limited to the browser push services by `push_subscriptions_provider_check`
  and `src/lib/push/subscription.ts`, so the notification cron can't be used as
  an SSRF relay (`85`).
- Security headers (CSP, HSTS, `frame-ancestors 'none'`) live in `next.config.ts`.
- `src/proxy.ts` uses `getClaims()` (local JWKS verification) rather than
  `getUser()` (a network round trip per request), and caches the "profile exists"
  check in the `grind_profile_ok` cookie instead of querying on every navigation.

## Auth check on every navigation (`src/proxy.ts`)
The proxy verifies the session with `getClaims()` before every page request. The
installed PWA resumes with an expired access token, so that call has to refresh
it, and supabase-js retries a failed refresh with back-off for about 30 seconds.
A per-request timeout cannot stop that loop, so the whole check is wrapped in
`withDeadline` (`src/lib/supabase/deadline.ts`, 4.5s).

If the check cannot finish, the proxy answers **503** immediately (a small
"Can't reach GRIND" page with a retry button; JSON for `/api`). It does not
redirect to `/login` (an unreachable server is not a signed-out user) and does
not pass the request on (the page would retry the same refresh). A 5xx also
makes the service worker answer with the last saved copy of the page. Signed-out
visitors still redirect to `/login`. The tab bar adds a last-resort watchdog
(`useNavWatchdog`): if a tap hasn't changed the page in 8s, it does a normal
full page load.

`getAuthUser()` (layout + pages) gives the Auth server 3s and then falls back to
the token the proxy already verified.
